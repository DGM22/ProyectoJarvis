import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { DOORBELL_SPEAK_FIRST_INSTRUCTIONS } from '../agents/doorbell-agent.constants';
import { ConsultService } from '../consult/consult.service';
import { SkillsRegistryService } from '../skills/skills-registry.service';
import { base64ToPcm, PcmStreamResampler, pcmToBase64 } from './pcm-resample';
import {
  RealtimeSessionConfigService,
  type SessionMode,
} from './realtime-session-config.service';

/** Callbacks hacia el gateway del dispositivo ESP32. */
export interface DeviceBridgeCallbacks {
  onAudioOut: (pcm16k: Buffer) => void;
  onDisplay: (state: DeviceDisplayState) => void;
  onSessionReady: () => void;
  onSessionEnd: (reason: string) => void;
  onError: (message: string) => void;
  /** Mensajes de control extra hacia el ESP32 (modo interfón, abrir puerta). */
  onControl?: (message: DeviceControlMessage) => void;
}

export type DeviceControlMessage =
  | { type: 'intercom.start' }
  | { type: 'intercom.end' }
  | { type: 'door.open'; holdMs: number };

export type DeviceDisplayState =
  'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

export type BridgeStartOptions = {
  reason: 'wake' | 'button' | 'inbound';
  voice?: string;
  /** Prompt extra para llamadas proactivas (app o alertas futuras). */
  inboundPrompt?: string;
  /** Modo de atención del timbre (solo `reason: 'button'`). */
  attention?: {
    /** Suena primero en la app; la IA habla cuando se acabe el tiempo o contestes. */
    ringFirst: boolean;
    ringMs: number;
    /** `false` = no molestar: sin `call_owner`. */
    ownerAvailable: boolean;
  };
};

interface RealtimeFunctionCallItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

interface BridgeState {
  openaiWs: WebSocket;
  callbacks: DeviceBridgeCallbacks;
  speaking: boolean;
  /** Resamplers con estado (uno por dirección) para audio sin saltos ni aliasing. */
  upsampler: PcmStreamResampler;
  downsampler: PcmStreamResampler;
  /** true tras el primer session.updated (sesión lista). */
  ready: boolean;
  closed: boolean;
  mode: SessionMode;
  /** OpenAI rechaza `response.create` mientras otra respuesta sigue viva. */
  responseActive: boolean;
  queuedResponse: Record<string, unknown> | null;
  /** Timbre en espera del dueño: no se oye ni se escucha al visitante. */
  paused: boolean;
  /** Pausa solicitada; se aplica al terminar la frase en curso ("un momento…"). */
  pausePending: boolean;
  /** Interfón activo: el mic del visitante va al dueño, no a OpenAI. */
  intercomSink: ((pcm16k: Buffer) => void) | null;
  /** Interfón pedido: la IA dice la frase de cambio y luego se activa. */
  intercomPending: {
    sink: (pcm16k: Buffer) => void;
    onLive: () => void;
  } | null;
  intercomFallback: NodeJS.Timeout | null;
  /** Diagnóstico del mic de la puerta: se reporta cada `AUDIO_DIAG_MS`. */
  diag: { frames: number; peak: number; speechStarted: number };
  diagTimer: NodeJS.Timeout | null;
  /** Marcas de tiempo para medir dónde se va la latencia (ver `logFirstAudio`). */
  /** La IA terminó su saludo: antes de eso no se escucha el mic (ruido inicial). */
  greetingDone: boolean;
  /** Modo Ring activo: suena en la app antes de que hable la IA. */
  ringFirst: { ringMs: number } | null;
  timing: {
    startedAt: number;
    greeted: boolean;
    speechStoppedAt: number | null;
    /** Qué disparó la respuesta que se está midiendo. */
    turnLabel: string;
    responseCreatedAt: number | null;
    firstAudioLogged: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const DEVICE_PCM_RATE = 16000;
const OPENAI_PCM_RATE = 24000;
/** Resumen que ve el dueño cuando el timbre suena antes de que hable la IA. */
const RING_FIRST_SUMMARY =
  'Alguien tocó el timbre. Todavía no se ha hablado con el visitante: míralo en la cámara y decide.';

/** Cada cuánto se loguea qué tanto audio del mic llega y qué oyó OpenAI. */
const AUDIO_DIAG_MS = 5000;

/** Pico de un frame PCM16 en dBFS (diagnóstico del mic). */
function peakDbfs(pcm: Buffer): number {
  let peak = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const v = Math.abs(pcm.readInt16LE(i));
    if (v > peak) peak = v;
  }
  return peak === 0 ? -120 : 20 * Math.log10(peak / 32768);
}

/** Si la frase de cambio no termina (error de OpenAI), el interfón abre igual. */
const INTERCOM_HANDOFF_MAX_MS = 8000;

/**
 * Puente OpenAI Realtime por WebSocket para clientes sin WebRTC (ESP32).
 *
 * Traduce PCM 16 kHz del dispositivo ↔ 24 kHz de OpenAI, ejecuta tools en el
 * mismo socket y notifica estados de pantalla (listening/speaking). En modo
 * timbre se registra en `ConsultService` para poder pausarse mientras el dueño
 * decide y reanudarse con su instrucción sin perder el contexto.
 */
@Injectable()
export class RealtimeWsBridgeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeWsBridgeService.name);
  private readonly bridges = new Map<string, BridgeState>();

  constructor(
    private readonly configService: ConfigService,
    private readonly sessionConfigService: RealtimeSessionConfigService,
    private readonly skillsRegistry: SkillsRegistryService,
    private readonly consultService: ConsultService,
  ) {}

  /** Indica si ya hay una sesión Realtime abierta para el dispositivo. */
  isInCall(deviceKey: string): boolean {
    const bridge = this.bridges.get(deviceKey);
    return Boolean(bridge && !bridge.closed);
  }

  /**
   * Abre una sesión Realtime WS hacia OpenAI para un dispositivo.
   *
   * @param deviceKey Identificador estable del socket del dispositivo.
   * @param callbacks Handlers de audio/display hacia el ESP32.
   * @param options Motivo de la sesión y prompt inbound opcional.
   */
  async start(
    deviceKey: string,
    callbacks: DeviceBridgeCallbacks,
    options: BridgeStartOptions,
  ): Promise<void> {
    if (this.isInCall(deviceKey)) {
      throw new ServiceUnavailableException('Device already in a call');
    }

    const apiKey = this.configService.get<string>('openai.apiKey');
    const model = this.configService.get<string>('openai.realtimeModel');
    if (!apiKey || !model) {
      throw new ServiceUnavailableException(
        'OPENAI_API_KEY / realtime model is not configured',
      );
    }

    callbacks.onDisplay('connecting');
    const startedAt = Date.now();

    const voice = this.sessionConfigService.resolveVoice(options.voice);
    const mode: SessionMode =
      options.reason === 'button' ? 'doorbell' : 'assistant';
    this.logger.log(
      `Starting ${mode} session for ${deviceKey} reason=${options.reason}`,
    );

    const extraInstructions =
      options.reason === 'inbound'
        ? [
            'This session was started by an inbound call to the physical Jarvis device.',
            options.inboundPrompt?.trim() ||
              'The user called you from the Jarvis web app. Greet them briefly and ask how you can help.',
            'Speak first after the session is ready; do not wait for the user to speak before greeting.',
          ].join(' ')
        : options.reason === 'button'
          ? 'Alguien acaba de pulsar el botón físico del timbre. Habla primero.'
          : undefined;

    const sessionConfig = await this.sessionConfigService.buildSessionConfig(
      model,
      voice,
      {
        extraInstructions,
        pcmRateHz: OPENAI_PCM_RATE,
        mode,
        ownerAvailable: options.attention?.ownerAvailable,
      },
    );

    this.logger.log(
      `[latencia] ${deviceKey} config de sesión en ${Date.now() - startedAt} ms ` +
        `(instrucciones ${sessionConfig.instructions.length} chars, ${sessionConfig.tools.length} tools, modelo ${model})`,
    );

    const openaiWs = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
      {
        // Sin `OpenAI-Beta: realtime=v1`: la API beta ya fue retirada y
        // rechaza la conexión con `beta_api_shape_disabled`.
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    const bridge: BridgeState = {
      openaiWs,
      callbacks,
      speaking: false,
      upsampler: new PcmStreamResampler(DEVICE_PCM_RATE, OPENAI_PCM_RATE),
      downsampler: new PcmStreamResampler(OPENAI_PCM_RATE, DEVICE_PCM_RATE),
      ready: false,
      closed: false,
      mode,
      responseActive: false,
      queuedResponse: null,
      paused: false,
      pausePending: false,
      intercomSink: null,
      intercomPending: null,
      intercomFallback: null,
      diag: { frames: 0, peak: -120, speechStarted: 0 },
      diagTimer: null,
      greetingDone: false,
      ringFirst: options.attention?.ringFirst
        ? { ringMs: options.attention.ringMs }
        : null,
      timing: {
        startedAt,
        greeted: false,
        speechStoppedAt: null,
        turnLabel: 'turno',
        responseCreatedAt: null,
        firstAudioLogged: false,
      },
    };
    this.bridges.set(deviceKey, bridge);
    bridge.diagTimer = setInterval(() => this.logAudioDiag(deviceKey), AUDIO_DIAG_MS);

    if (mode === 'doorbell') {
      this.consultService.registerDoorbell(deviceKey, {
        pause: () => this.pause(deviceKey),
        resume: (instruction) => this.resume(deviceKey, instruction),
        startIntercom: (toOwner, handoff, onLive) =>
          this.startIntercom(deviceKey, toOwner, handoff, onLive),
        sendToVisitor: (pcm16k) => {
          const current = this.bridges.get(deviceKey);
          if (current?.intercomSink && !current.closed) {
            current.callbacks.onAudioOut(pcm16k);
          }
        },
        setOwnerTalking: (talking) => {
          const current = this.bridges.get(deviceKey);
          if (current?.intercomSink && !current.closed) {
            // El ESP32 silencia su mic con 'speaking': así no regresa tu voz.
            current.callbacks.onDisplay(talking ? 'speaking' : 'listening');
          }
        },
        stopIntercom: (note) => this.stopIntercom(deviceKey, note),
      });
    }

    openaiWs.on('open', () => {
      this.logger.log(
        `OpenAI Realtime WS open for device ${deviceKey} (+${Date.now() - startedAt} ms)`,
      );
      this.send(openaiWs, {
        type: 'session.update',
        session: sessionConfig,
      });
    });

    openaiWs.on('message', (data) => {
      void this.handleOpenAiMessage(deviceKey, data.toString());
    });

    openaiWs.on('close', () => {
      this.logger.log(`OpenAI Realtime WS closed for device ${deviceKey}`);
      this.finish(deviceKey, 'openai_closed');
    });

    openaiWs.on('error', (error) => {
      this.logger.error(
        `OpenAI Realtime WS error for device ${deviceKey}: ${error.message}`,
      );
      callbacks.onError(error.message);
      this.finish(deviceKey, 'openai_error');
    });
  }

  /**
   * Reenvía audio PCM16LE 16 kHz del micrófono del ESP32 a OpenAI.
   *
   * Durante `speaking` el gateway no debería llamar esto (half-duplex v1).
   */
  appendInputAudio(deviceKey: string, pcm16k: Buffer): void {
    const bridge = this.bridges.get(deviceKey);
    if (!bridge || bridge.closed) {
      return;
    }
    bridge.diag.frames++;
    bridge.diag.peak = Math.max(bridge.diag.peak, peakDbfs(pcm16k));

    // Interfón: la voz del visitante va directo al dueño, OpenAI no la oye.
    if (bridge.intercomSink) {
      bridge.intercomSink(pcm16k);
      return;
    }
    // En espera del dueño el mic de la puerta queda en mute hasta que llegue
    // su instrucción: si no, el ruido/visitante se mezcla con la consulta.
    if (
      bridge.intercomPending ||
      bridge.speaking ||
      bridge.paused ||
      !bridge.greetingDone
    ) {
      return;
    }
    if (bridge.openaiWs.readyState !== WebSocket.OPEN) {
      return;
    }

    const pcm24k = bridge.upsampler.process(pcm16k);
    this.send(bridge.openaiWs, {
      type: 'input_audio_buffer.append',
      audio: pcmToBase64(pcm24k),
    });
  }

  /** Cierra la sesión Realtime y notifica al dispositivo. */
  end(deviceKey: string, reason = 'client_end'): void {
    this.finish(deviceKey, reason);
  }

  onModuleDestroy(): void {
    for (const key of [...this.bridges.keys()]) {
      this.finish(key, 'server_shutdown');
    }
  }

  /** Pone al visitante en espera en cuanto termine la respuesta en curso. */
  private pause(deviceKey: string): void {
    const bridge = this.bridges.get(deviceKey);
    if (!bridge || bridge.closed || bridge.paused) {
      return;
    }
    bridge.pausePending = true;
    this.logger.log(`Doorbell ${deviceKey} pause requested`);
  }

  /** Reanuda al visitante con una instrucción de sistema (decisión del dueño). */
  private resume(deviceKey: string, instruction: string): void {
    const bridge = this.bridges.get(deviceKey);
    if (!bridge || bridge.closed) {
      return;
    }
    bridge.paused = false;
    bridge.pausePending = false;
    this.logger.log(`Doorbell ${deviceKey} resumed`);

    // El mic estuvo en mute durante la espera: se limpia cualquier resto.
    this.send(bridge.openaiWs, { type: 'input_audio_buffer.clear' });
    // Esta respuesta la dispara tu decisión, no la voz del visitante.
    bridge.timing.speechStoppedAt = Date.now();
    bridge.timing.turnLabel = 'reanudación: instrucción del dueño';
    this.send(bridge.openaiWs, {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: instruction }],
      },
    });
    this.requestResponse(bridge, { type: 'response.create' });
    bridge.callbacks.onDisplay('listening');
  }

  /**
   * Entra al interfón. Con `handoff`, la IA dice esa frase (cancelando lo que
   * estuviera diciendo) y el cambio ocurre en su `response.done`.
   */
  private startIntercom(
    deviceKey: string,
    toOwner: (pcm16k: Buffer) => void,
    handoff: string | null,
    onLive: () => void,
  ): void {
    const bridge = this.bridges.get(deviceKey);
    if (!bridge || bridge.closed) {
      return;
    }
    bridge.pausePending = false;
    bridge.intercomPending = { sink: toOwner, onLive };

    if (!handoff) {
      this.activateIntercom(deviceKey, bridge);
      return;
    }

    bridge.paused = false;
    if (bridge.responseActive) {
      this.send(bridge.openaiWs, { type: 'response.cancel' });
    }
    this.send(bridge.openaiWs, { type: 'input_audio_buffer.clear' });
    this.send(bridge.openaiWs, {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: handoff }],
      },
    });
    this.requestResponse(bridge, { type: 'response.create' });
    bridge.intercomFallback = setTimeout(() => {
      const current = this.bridges.get(deviceKey);
      if (current?.intercomPending) {
        this.logger.warn(
          `Doorbell ${deviceKey} handoff timed out, opening intercom`,
        );
        this.activateIntercom(deviceKey, current);
      }
    }, INTERCOM_HANDOFF_MAX_MS);
    this.logger.log(`Doorbell ${deviceKey} intercom handoff`);
  }

  private activateIntercom(deviceKey: string, bridge: BridgeState): void {
    const pending = bridge.intercomPending;
    if (!pending || bridge.closed) {
      return;
    }
    if (bridge.intercomFallback) {
      clearTimeout(bridge.intercomFallback);
      bridge.intercomFallback = null;
    }
    bridge.intercomPending = null;
    bridge.intercomSink = pending.sink;
    // La IA queda muda y sorda (sin cerrar la sesión: conserva el contexto).
    bridge.paused = true;
    bridge.speaking = false;
    this.send(bridge.openaiWs, { type: 'input_audio_buffer.clear' });
    bridge.callbacks.onControl?.({ type: 'intercom.start' });
    bridge.callbacks.onDisplay('listening');
    this.logger.log(`Doorbell ${deviceKey} intercom on`);
    pending.onLive();
  }

  /** Sale del interfón: la IA sigue en espera y sabe que el dueño habló. */
  private stopIntercom(deviceKey: string, note: string): void {
    const bridge = this.bridges.get(deviceKey);
    if (
      !bridge ||
      bridge.closed ||
      (!bridge.intercomSink && !bridge.intercomPending)
    ) {
      return;
    }
    if (bridge.intercomFallback) {
      clearTimeout(bridge.intercomFallback);
      bridge.intercomFallback = null;
    }
    bridge.intercomSink = null;
    bridge.intercomPending = null;
    bridge.paused = true;
    bridge.pausePending = false;
    this.send(bridge.openaiWs, { type: 'input_audio_buffer.clear' });
    // Contexto sin pedir respuesta: la IA solo habla cuando la reanuden.
    this.send(bridge.openaiWs, {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: note }],
      },
    });
    bridge.callbacks.onControl?.({ type: 'intercom.end' });
    bridge.callbacks.onDisplay('connecting');
    this.logger.log(`Doorbell ${deviceKey} intercom off`);
  }

  /**
   * Una línea por intervalo: frames del mic recibidos (50/s = continuo), su
   * pico y cuántas veces OpenAI detectó voz. Mic con frames pero sin voz
   * detectada = llega muy bajo o con ruido; sin frames = la ESP32 no manda.
   */
  private logAudioDiag(deviceKey: string): void {
    const bridge = this.bridges.get(deviceKey);
    if (!bridge || bridge.closed) {
      return;
    }
    const { frames, peak, speechStarted } = bridge.diag;
    const state = bridge.intercomSink
      ? 'interfon'
      : bridge.paused
        ? 'en espera'
        : bridge.speaking
          ? 'IA hablando'
          : 'escuchando';
    this.logger.log(
      `Mic ${deviceKey} [${state}]: ${frames} frames/${AUDIO_DIAG_MS / 1000}s, pico ${peak.toFixed(1)} dBFS, voz detectada ${speechStarted}x`,
    );
    bridge.diag = { frames: 0, peak: -120, speechStarted: 0 };
  }

  /**
   * Una línea por respuesta: cuánto tardó OpenAI en empezar a hablar desde que
   * detectó el fin de tu voz (o desde el botón, para el saludo).
   */
  private logFirstAudio(deviceKey: string, bridge: BridgeState): void {
    const now = Date.now();
    const { timing } = bridge;
    if (!timing.greeted) {
      timing.greeted = true;
      this.logger.log(
        `[latencia] ${deviceKey} saludo: primer audio a los ${now - timing.startedAt} ms del botón`,
      );
      return;
    }
    if (timing.speechStoppedAt === null) {
      return;
    }
    const created = timing.responseCreatedAt
      ? `respuesta creada +${timing.responseCreatedAt - timing.speechStoppedAt} ms, `
      : '';
    this.logger.log(
      `[latencia] ${deviceKey} ${timing.turnLabel} → ${created}primer audio +${now - timing.speechStoppedAt} ms` +
        (timing.turnLabel.startsWith('turno') ? ' (más ~450 ms de silencio que espera el VAD)' : ''),
    );
    timing.speechStoppedAt = null;
  }

  private requestResponse(
    bridge: BridgeState,
    payload: Record<string, unknown>,
  ): void {
    if (bridge.responseActive) {
      bridge.queuedResponse = payload;
      return;
    }
    bridge.responseActive = true;
    this.send(bridge.openaiWs, payload);
  }

  private finish(deviceKey: string, reason: string): void {
    const bridge = this.bridges.get(deviceKey);
    if (!bridge || bridge.closed) {
      return;
    }
    bridge.closed = true;
    if (bridge.diagTimer) {
      clearInterval(bridge.diagTimer);
      bridge.diagTimer = null;
    }
    if (bridge.intercomFallback) {
      clearTimeout(bridge.intercomFallback);
      bridge.intercomFallback = null;
    }
    try {
      if (bridge.openaiWs.readyState === WebSocket.OPEN) {
        bridge.openaiWs.close();
      }
    } catch {
      // ignore
    }
    this.bridges.delete(deviceKey);
    if (bridge.mode === 'doorbell') {
      this.consultService.unregisterDoorbell(deviceKey);
    }
    bridge.callbacks.onDisplay('idle');
    bridge.callbacks.onSessionEnd(reason);
  }

  private async handleOpenAiMessage(
    deviceKey: string,
    raw: string,
  ): Promise<void> {
    const bridge = this.bridges.get(deviceKey);
    if (!bridge || bridge.closed) {
      return;
    }

    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(event) || typeof event.type !== 'string') {
      return;
    }

    const type = event.type;

    if (type === 'session.updated') {
      if (bridge.ready) {
        return;
      }
      bridge.ready = true;
      this.logger.log(
        `[latencia] ${deviceKey} sesión lista en ${Date.now() - bridge.timing.startedAt} ms`,
      );
      bridge.callbacks.onSessionReady();

      // Modo Ring: primero suena en la app y la IA se queda callada, sin
      // saludar, hasta que se acabe el tiempo o el dueño decida.
      if (bridge.mode === 'doorbell' && bridge.ringFirst) {
        bridge.paused = true;
        bridge.greetingDone = true;
        bridge.callbacks.onDisplay('connecting');
        this.consultService.callOwner(deviceKey, RING_FIRST_SUMMARY, {
          ringMs: bridge.ringFirst.ringMs,
          ringFirst: true,
        });
        return;
      }

      bridge.callbacks.onDisplay('listening');
      this.requestResponse(bridge, {
        type: 'response.create',
        ...(bridge.mode === 'doorbell'
          ? {
              response: {
                instructions: DOORBELL_SPEAK_FIRST_INSTRUCTIONS,
              },
            }
          : {}),
      });
      return;
    }

    if (type === 'session.created') {
      // Esperamos session.updated tras nuestro session.update.
      return;
    }

    if (type === 'response.created') {
      bridge.responseActive = true;
      bridge.timing.responseCreatedAt = Date.now();
      bridge.timing.firstAudioLogged = false;
      return;
    }

    if (type === 'input_audio_buffer.speech_stopped') {
      // OpenAI lo manda tras ~500 ms de silencio (server_vad): eso ya es espera.
      bridge.timing.speechStoppedAt = Date.now();
      bridge.timing.turnLabel = 'turno: fin de voz';
    }

    if (type === 'error') {
      const message =
        isRecord(event.error) && typeof event.error.message === 'string'
          ? event.error.message
          : 'Realtime error';
      this.logger.error(`Realtime error for ${deviceKey}: ${message}`);
      // Un response.create rechazado no emitirá response.done.
      if (!/active response/i.test(message)) {
        bridge.responseActive = false;
      }
      bridge.callbacks.onError(message);
      bridge.callbacks.onDisplay('error');
      // Si falló el arranque la sesión no sirve; cerrarla libera el dispositivo.
      if (!bridge.ready) {
        this.finish(deviceKey, 'openai_error');
      }
      return;
    }

    if (bridge.mode === 'doorbell') {
      this.captureTranscript(deviceKey, type, event);
    }

    if (type === 'input_audio_buffer.speech_started') {
      bridge.diag.speechStarted++;
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      this.logger.log(
        `Mic ${deviceKey} OpenAI entendió: "${String(event.transcript ?? '').trim()}"`,
      );
    }

    if (
      type === 'input_audio_buffer.speech_started' ||
      type === 'input_audio_buffer.speech_stopped'
    ) {
      if (!bridge.speaking && !bridge.paused) {
        bridge.callbacks.onDisplay('listening');
      }
      return;
    }

    if (
      type === 'response.output_audio.delta' ||
      type === 'response.audio.delta'
    ) {
      if (bridge.paused) {
        return;
      }
      const delta =
        typeof event.delta === 'string'
          ? event.delta
          : typeof event.audio === 'string'
            ? event.audio
            : null;
      if (!delta) {
        return;
      }
      if (!bridge.speaking) {
        bridge.speaking = true;
        bridge.callbacks.onDisplay('speaking');
      }
      if (!bridge.timing.firstAudioLogged) {
        bridge.timing.firstAudioLogged = true;
        this.logFirstAudio(deviceKey, bridge);
      }
      const pcm24k = base64ToPcm(delta);
      const pcm16k = bridge.downsampler.process(pcm24k);
      bridge.callbacks.onAudioOut(pcm16k);
      return;
    }

    if (
      type === 'response.output_audio.done' ||
      type === 'response.audio.done'
    ) {
      bridge.speaking = false;
      if (!bridge.paused) {
        bridge.callbacks.onDisplay('listening');
      }
      return;
    }

    if (type === 'response.done') {
      bridge.speaking = false;
      bridge.responseActive = false;
      if (!bridge.greetingDone) {
        bridge.greetingDone = true;
        // Lo que entró mientras saludaba era ruido del arranque.
        this.send(bridge.openaiWs, { type: 'input_audio_buffer.clear' });
      }
      // Tools viven en response.done (mismo patrón que el sideband WebRTC).
      const calledTools = await this.handleFunctionCalls(deviceKey, bridge, event);
      if (calledTools) {
        return;
      }

      if (bridge.queuedResponse) {
        const queued = bridge.queuedResponse;
        bridge.queuedResponse = null;
        this.requestResponse(bridge, queued);
        return;
      }

      // Terminó "te comunico…": ahora sí habla el dueño.
      if (bridge.intercomPending) {
        this.activateIntercom(deviceKey, bridge);
        return;
      }

      if (bridge.pausePending) {
        bridge.pausePending = false;
        bridge.paused = true;
        this.send(bridge.openaiWs, { type: 'input_audio_buffer.clear' });
        bridge.callbacks.onDisplay('connecting');
        this.logger.log(`Doorbell ${deviceKey} paused waiting for owner`);
        return;
      }

      if (!bridge.paused) {
        bridge.callbacks.onDisplay('listening');
      }
    }
  }

  /** Reenvía lo que se dice en la puerta a la consulta activa (contexto del dueño). */
  private captureTranscript(
    deviceKey: string,
    type: string,
    event: Record<string, unknown>,
  ): void {
    if (typeof event.transcript !== 'string') {
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      this.consultService.appendTranscript(deviceKey, 'visitor', event.transcript);
    } else if (
      type === 'response.output_audio_transcript.done' ||
      type === 'response.audio_transcript.done'
    ) {
      this.consultService.appendTranscript(deviceKey, 'doorbell', event.transcript);
    }
  }

  /** @returns true si hubo tools y ya se pidió la respuesta de seguimiento. */
  private async handleFunctionCalls(
    deviceKey: string,
    bridge: BridgeState,
    event: Record<string, unknown>,
  ): Promise<boolean> {
    const response = isRecord(event.response) ? event.response : null;
    const output = Array.isArray(response?.output) ? response.output : [];

    const functionCalls = output.filter(
      (item): item is RealtimeFunctionCallItem =>
        isRecord(item) &&
        item.type === 'function_call' &&
        typeof item.call_id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.arguments === 'string',
    );
    if (functionCalls.length === 0) {
      return false;
    }

    for (const functionCall of functionCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(functionCall.arguments) as Record<string, unknown>;
      } catch {
        args = {};
      }

      const openDoor = (holdMs: number): boolean => {
        if (bridge.closed || !bridge.callbacks.onControl) {
          return false;
        }
        bridge.callbacks.onControl({ type: 'door.open', holdMs });
        this.logger.log(`Doorbell ${deviceKey} door open (${holdMs} ms)`);
        return true;
      };

      let toolOutput: unknown;
      const toolStartedAt = Date.now();
      try {
        toolOutput = await this.skillsRegistry.execute(functionCall.name, args, {
          channel: 'device',
          sessionKey: deviceKey,
          mode: bridge.mode,
          openDoor,
        });
      } catch (error) {
        toolOutput = {
          error:
            error instanceof Error ? error.message : 'Tool execution failed',
        };
      }

      this.logger.log(
        `[latencia] ${deviceKey} tool ${functionCall.name} tardó ${Date.now() - toolStartedAt} ms`,
      );
      this.send(bridge.openaiWs, {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: functionCall.call_id,
          output: JSON.stringify(toolOutput),
        },
      });
    }

    if (!bridge.closed) {
      this.requestResponse(bridge, { type: 'response.create' });
    }
    return true;
  }

  private send(ws: WebSocket, payload: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}
