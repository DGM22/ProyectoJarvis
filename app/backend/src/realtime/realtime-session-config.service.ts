import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { AgentsService } from '../agents/agents.service';
import {
  DOORBELL_AGENT_SLUG,
  DOORBELL_OPERATIONAL_RULES,
} from '../agents/doorbell-agent.constants';
import {
  SECURITY_AGENT_SLUG,
  SECURITY_OPERATIONAL_RULES,
} from '../agents/security-agent.constants';
import { ConsultService } from '../consult/consult.service';
import { GoogleAuthService } from '../google/google-auth.service';
import { HouseholdService } from '../household/household.service';
import { KbFactsService } from '../knowledge-base/kb-facts.service';
import type { SessionMode } from '../skills/skill.interface';
import { SkillsRegistryService } from '../skills/skills-registry.service';
import { isRealtimeVoice, type RealtimeVoice } from './realtime-voices';

export type { SessionMode };

export type RealtimeSessionConfig = {
  type: 'realtime';
  model: string;
  instructions: string;
  tools: ReturnType<SkillsRegistryService['getAllTools']>;
  tool_choice: 'auto';
  output_modalities: ['audio'];
  audio: {
    input: {
      format?: { type: 'audio/pcm'; rate: number };
      transcription: { model: string };
      turn_detection: {
        type: 'server_vad';
        create_response: boolean;
        interrupt_response: boolean;
      };
    };
    output: {
      format?: { type: 'audio/pcm'; rate: number };
      voice: RealtimeVoice;
    };
  };
};

export type SessionConfigOptions = {
  /** Texto extra inyectado en las instrucciones (alertas, inbound call, etc.). */
  extraInstructions?: string;
  /**
   * Formato PCM explícito para el transporte WebSocket del ESP32.
   * WebRTC (navegador) no lo necesita: OpenAI negocia el codec en SDP.
   */
  pcmRateHz?: 16000 | 24000;
  mode?: SessionMode;
  /** Requerido en modo `security`: consulta del timbre que atiende el dueño. */
  consultId?: string;
};

/**
 * Construye la configuración de sesión Realtime compartida por WebRTC y por el
 * puente WebSocket del ESP32, según la persona (Jarvis, timbre o seguridad).
 */
@Injectable()
export class RealtimeSessionConfigService {
  constructor(
    private readonly configService: ConfigService,
    private readonly skillsRegistry: SkillsRegistryService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly activityLogService: ActivityLogService,
    private readonly agentsService: AgentsService,
    private readonly kbFactsService: KbFactsService,
    private readonly householdService: HouseholdService,
    private readonly consultService: ConsultService,
  ) {}

  /**
   * Valida la voz pedida contra la lista permitida.
   *
   * @param requestedVoice Voz recibida del cliente, o indefinida.
   */
  resolveVoice(requestedVoice: string | undefined): RealtimeVoice {
    const defaultVoice =
      this.configService.get<string>('openai.realtimeVoice') ?? 'cedar';

    if (requestedVoice === undefined || requestedVoice === '') {
      if (isRealtimeVoice(defaultVoice)) {
        return defaultVoice;
      }
      return 'cedar';
    }

    if (!isRealtimeVoice(requestedVoice)) {
      throw new BadRequestException(
        `Invalid voice "${requestedVoice}". Allowed: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar`,
      );
    }

    return requestedVoice;
  }

  /**
   * Arma el objeto `session` que OpenAI espera en `/realtime/calls` o en
   * `session.update` del WebSocket.
   *
   * @param model Modelo Realtime configurado.
   * @param voice Voz de salida validada.
   * @param options Persona, consulta, prompt inbound y rate PCM.
   */
  async buildSessionConfig(
    model: string,
    voice: RealtimeVoice,
    options: SessionConfigOptions = {},
  ): Promise<RealtimeSessionConfig> {
    const mode = options.mode ?? 'assistant';
    const timezone =
      this.configService.get<string>('app.timezone') ?? 'America/Mexico_City';
    const now = new Date().toLocaleString('es-MX', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'short',
    });

    const [kbCoreContext, householdContext] = await Promise.all([
      this.kbFactsService.buildCoreContextSummary(),
      this.householdService.buildContextSummary(),
    ]);

    const common = [
      `Current local datetime: ${now} (${timezone}).`,
      householdContext,
    ];

    let instructions: Array<string | undefined>;
    if (mode === 'doorbell') {
      instructions = [
        await this.agentsService.getSystemPrompt(DOORBELL_AGENT_SLUG),
        DOORBELL_OPERATIONAL_RULES,
        ...common,
        'When the visitor sends a text message during the call, treat it as first-class input.',
        options.extraInstructions,
        kbCoreContext,
      ];
    } else if (mode === 'security') {
      if (!options.consultId) {
        throw new BadRequestException('consultId is required in security mode');
      }
      instructions = [
        await this.agentsService.getSystemPrompt(SECURITY_AGENT_SLUG),
        SECURITY_OPERATIONAL_RULES,
        ...common,
        this.consultService.buildOwnerContext(options.consultId),
        await this.buildGoogleHint(),
        'After a tool succeeds, confirm the result briefly in clear neutral Spanish.',
        options.extraInstructions,
        kbCoreContext,
      ];
    } else {
      instructions = [
        'You are Jarvis, a helpful voice assistant for the owner of the house.',
        'Open every conversation with exactly this short greeting in Spanish: "Hola, ¿en qué te puedo ayudar?" Then stop and wait for the user.',
        ...common,
        await this.buildGoogleHint(),
        'When the user asks to schedule events, manage tasks, manage Gmail, or manage Drive files, ask clarifying questions until you have title, date, and time.',
        'Before calling create_calendar_event, create_task, get_task, update_task, complete_task, delete_task, list_gmail_messages, get_gmail_message, create_gmail_draft, update_gmail_draft, delete_gmail_message, create_drive_file, get_drive_file, update_drive_file, delete_drive_file, confirm missing details with the user.',
        'Before delete_calendar_event or delete_task, ask for explicit confirmation.',
        'Use list_calendar_events, list_tasks, list_gmail_messages, or list_drive_files first when you need an ID for update/delete/complete operations.',
        'When the owner asks to add or update someone who lives in the house, use household_save_member.',
        'When the user says to remember something lasting about the house, preferences, or procedures, call kb_save_fact with a clear canonical_text. Use kb_search when you need details beyond the core knowledge block.',
        'When the user sends a text message during the call, treat it as first-class input with the same priority as speech. Use any details in that text as ground truth for tools.',
        'After a tool succeeds, confirm the result briefly in clear neutral Spanish (not English-accented) unless the user prefers English.',
        this.consultService.buildActiveContextSummary(),
        options.extraInstructions,
        kbCoreContext,
        await this.activityLogService.buildContextSummary(10),
      ];
    }

    const { audioInput, audioOutput } = this.buildAudioConfig(
      voice,
      options.pcmRateHz,
    );

    return {
      type: 'realtime',
      model,
      instructions: instructions.filter(Boolean).join('\n'),
      tools: this.skillsRegistry.getToolsForMode(mode),
      tool_choice: 'auto',
      output_modalities: ['audio'],
      audio: {
        input: audioInput,
        output: audioOutput,
      },
    };
  }

  private async buildGoogleHint(): Promise<string> {
    const googleStatus = await this.googleAuthService.getStatus();
    return googleStatus.connected
      ? `Google account connected${googleStatus.email ? ` (${googleStatus.email})` : ''}.`
      : 'Google is NOT connected yet. If the user asks for calendar, tasks, Gmail, or Drive actions, tell them to open GET /google/auth/connect in the browser to connect Google first.';
  }

  private buildAudioConfig(
    voice: RealtimeVoice,
    pcmRateHz?: 16000 | 24000,
  ): {
    audioInput: RealtimeSessionConfig['audio']['input'];
    audioOutput: RealtimeSessionConfig['audio']['output'];
  } {
    const audioInput: RealtimeSessionConfig['audio']['input'] = {
      transcription: {
        model: 'whisper-1',
      },
      turn_detection: {
        type: 'server_vad',
        create_response: true,
        interrupt_response: true,
      },
    };

    const audioOutput: RealtimeSessionConfig['audio']['output'] = {
      voice,
    };

    if (pcmRateHz) {
      audioInput.format = { type: 'audio/pcm', rate: pcmRateHz };
      audioOutput.format = { type: 'audio/pcm', rate: pcmRateHz };
    }

    return { audioInput, audioOutput };
  }
}
