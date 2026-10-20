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
      transcription: { model: string; language?: string };
      noise_reduction?: { type: 'near_field' | 'far_field' };
      turn_detection: TurnDetection;
    };
    output: {
      format?: { type: 'audio/pcm'; rate: number };
      voice: RealtimeVoice;
    };
  };
};

export type TurnDetection = {
  type: 'server_vad';
  threshold?: number;
  prefix_padding_ms?: number;
  silence_duration_ms?: number;
  create_response: boolean;
  interrupt_response: boolean;
};

/**
 * Detección de turno para el mic de la ESP32 (lejano, sin cancelación de eco
 * y con ruido). Medido: con los valores por defecto el ruido de la puerta se
 * tomaba como voz y cancelaba el saludo (~4 s perdidos).
 */
export function deviceTurnDetection(): TurnDetection {
  return {
    type: 'server_vad',
    // Más alto que el 0.5 por defecto: ruido de calle/cables no abre turno.
    threshold: 0.65,
    prefix_padding_ms: 300,
    silence_duration_ms: 450,
    create_response: true,
    // La puerta es half-duplex: lo que suena en su bocina regresa al mic y
    // cortaría a la IA a media frase.
    interrupt_response: false,
  };
}

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
  /**
   * `false` = modo "no molestar": el timbre atiende solo y toma recado, sin
   * `call_owner`. Por defecto el dueño sí está disponible.
   */
  ownerAvailable?: boolean;
};

/** Instrucciones del timbre cuando el dueño no quiere que lo llamen. */
export const DOORBELL_DO_NOT_DISTURB_INSTRUCTIONS =
  'El dueño activó "no molestar": NO puedes llamarlo ni pasarle al visitante. Atiende tú solo: ' +
  'pregunta a quién busca y a qué viene, resuelve lo que puedas y, si hace falta algo del dueño, ' +
  'toma un recado completo (nombre, motivo y contacto) y guárdalo con kb_save_fact. ' +
  'No digas que el dueño no está en casa ni si hay alguien: solo que por ahora no puede atender.';

/**
 * Construye la configuración de sesión Realtime compartida por WebRTC y por el
 * puente WebSocket del ESP32, según la persona (Jarvis, timbre o seguridad).
 */
@Injectable()
export class RealtimeSessionConfigService {
  constructor(
    private readonly configService: ConfigService,
    private readonly skillsRegistry: SkillsRegistryService,
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
        options.ownerAvailable === false ? DOORBELL_DO_NOT_DISTURB_INSTRUCTIONS : undefined,
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
        'After a tool succeeds, confirm the result briefly in clear neutral Spanish.',
        options.extraInstructions,
        kbCoreContext,
      ];
    } else {
      instructions = [
        'You are Jarvis, a helpful voice assistant for the owner of the house.',
        'Open every conversation with exactly this short greeting in Spanish: "Hola, ¿en qué te puedo ayudar?" Then stop and wait for the user.',
        ...common,
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
      tools: this.skillsRegistry
        .getToolsForMode(mode)
        .filter((tool) => options.ownerAvailable !== false || tool.name !== 'call_owner'),
      tool_choice: 'auto',
      output_modalities: ['audio'],
      audio: {
        input: audioInput,
        output: audioOutput,
      },
    };
  }

  private buildAudioConfig(
    voice: RealtimeVoice,
    pcmRateHz?: 16000 | 24000,
  ): {
    audioInput: RealtimeSessionConfig['audio']['input'];
    audioOutput: RealtimeSessionConfig['audio']['output'];
  } {
    // `pcmRateHz` solo lo pide el puente de la ESP32; el navegador va por WebRTC.
    const isDevice = pcmRateHz !== undefined;
    const audioInput: RealtimeSessionConfig['audio']['input'] = {
      // Sin idioma fijo, el ruido se transcribía como hindi o "3.1, 3.1…".
      transcription: {
        model: 'whisper-1',
        language: 'es',
      },
      noise_reduction: { type: isDevice ? 'far_field' : 'near_field' },
      turn_detection: isDevice
        ? deviceTurnDetection()
        : {
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
