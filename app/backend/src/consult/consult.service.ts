import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import {
  ACTIVE_CONSULT_STATUSES,
  type ConsultClientMessage,
  type ConsultEvent,
  type ConsultListener,
  type ConsultServerMessage,
  type ConsultSnapshot,
  type ConsultStatus,
  type ConsultTranscriptLine,
  type DoorbellController,
  type IntercomState,
  type OwnerIntercomLink,
  type OwnerSessionController,
} from './consult.types';
import { isLikelyHallucination } from './transcript-filter';

/** Tiempo que suena la web antes de que el timbre tome recado solo. */
const RING_TIMEOUT_MS = 45_000;
const MAX_TRANSCRIPT_LINES = 40;
/** Consultas cerradas que se conservan para el contexto de llamadas tardías. */
const ENDED_RETENTION_MS = 30 * 60_000;

const NO_ANSWER_INSTRUCTION =
  'El dueño no contestó. Dile al visitante con amabilidad que en este momento no puede atender y ofrece tomar un recado (nombre, motivo y contacto). Guárdalo con kb_save_fact.';
const DECLINED_INSTRUCTION =
  'El dueño no puede atender ahora. Dile al visitante con amabilidad que en este momento no es posible y ofrece tomar un recado. No digas que el dueño rechazó la llamada ni si hay alguien en casa.';
const OWNER_LEFT_INSTRUCTION =
  'El dueño colgó sin dejar instrucción. Dile al visitante que por ahora no es posible atenderlo y ofrece tomar un recado.';
/** Antepuesto cuando la IA reanuda sin haber saludado (modo Ring). */
const RING_FIRST_GREETING =
  'Todavía no has hablado con el visitante: empieza con un saludo breve y cordial. Después:';
const CLOSED_INSTRUCTION =
  'La consulta con el dueño terminó. Si el visitante sigue ahí, despídete con amabilidad u ofrece tomar un recado.';
/** Lo único que dice la IA del timbre antes de ceder la bocina al dueño. */
const INTERCOM_HANDOFF_INSTRUCTION =
  'El dueño va a hablar directamente con el visitante por la bocina. Dile al visitante solo una frase muy corta, por ejemplo "Te comunico, un momento", y no digas nada más.';
const INTERCOM_DOORBELL_NOTE =
  'El dueño habló directamente con el visitante por el interfón (tú no escuchaste esa parte). El visitante sigue en la puerta; espera la siguiente instrucción.';
const INTERCOM_BACK_TO_OWNER =
  'El dueño terminó de hablar directo con el visitante, que sigue en la puerta en espera. Pregúntale brevemente si quiere que le digas algo más al visitante o terminar la consulta.';
const INTERCOM_CLOSED_INSTRUCTION =
  'El dueño ya habló directamente con el visitante y terminó la consulta. Si el visitante sigue ahí, despídete en una frase corta.';

interface DoorbellSession {
  controller: DoorbellController;
  transcript: ConsultTranscriptLine[];
  consultId: string | null;
}

interface ConsultState {
  id: string;
  sessionKey: string;
  status: ConsultStatus;
  visitorSummary: string;
  awaitingOwner: boolean;
  lastInstruction: string | null;
  createdAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  ringExpiresAt: Date | null;
  ringTimer: NodeJS.Timeout | null;
  /** Suena antes de que la IA hable: falta el saludo al reanudar. */
  greetPending: boolean;
  intercom: IntercomState;
  intercomLink: OwnerIntercomLink | null;
}

/** Opciones del timbrazo (modo Ring: suena primero, la IA después). */
export interface CallOwnerOptions {
  /** Cuánto suena antes de tomar recado (por defecto `RING_TIMEOUT_MS`). */
  ringMs?: number;
  /** La IA todavía no ha saludado: al reanudar debe empezar saludando. */
  ringFirst?: boolean;
}

export interface CallOwnerResult {
  status: 'ringing' | 'owner_notified';
  consultId: string;
  message: string;
}

export interface InstructResult {
  delivered: boolean;
  consultId: string;
  reason?: string;
}

/**
 * Orquesta la consulta entre el agente del timbre (ESP32) y el dueño (web).
 *
 * El timbre se pausa sin cerrar su sesión OpenAI, así conserva el contexto de
 * voz; la web recibe el anillo por `/consult` y, al contestar, abre una sesión
 * `security` que devuelve la decisión con `instruct_doorbell`.
 */
@Injectable()
export class ConsultService implements OnModuleDestroy {
  private readonly logger = new Logger(ConsultService.name);
  private readonly doorbells = new Map<string, DoorbellSession>();
  private readonly consults = new Map<string, ConsultState>();
  private readonly ownerSessions = new Map<string, OwnerSessionController>();
  private readonly viewers = new Set<WebSocket>();
  private readonly listeners = new Set<ConsultListener>();
  /** Persona de la web que mandó cada socket `/consult` (quién contestó). */
  private readonly viewerPeople = new Map<WebSocket, number>();

  /** Suscribe a los eventos de las consultas (p. ej. el historial de visitas). */
  addListener(listener: ConsultListener): void {
    this.listeners.add(listener);
  }

  private emit(event: ConsultEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn(
          `Consult listener failed on ${event.type}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Timbre (puente ESP32)
  // ---------------------------------------------------------------------------

  registerDoorbell(sessionKey: string, controller: DoorbellController): void {
    this.doorbells.set(sessionKey, {
      controller,
      transcript: [],
      consultId: null,
    });
  }

  /** La sesión del timbre terminó (visitante colgó, ESP32 se desconectó…). */
  unregisterDoorbell(sessionKey: string): void {
    const doorbell = this.doorbells.get(sessionKey);
    this.doorbells.delete(sessionKey);
    if (!doorbell?.consultId) {
      return;
    }

    const consult = this.consults.get(doorbell.consultId);
    if (!consult || !this.isActive(consult)) {
      return;
    }

    this.ownerSessions
      .get(consult.id)
      ?.notify(
        'El visitante ya no está en el timbre (la llamada de la puerta terminó). Avísale al dueño y cierra la consulta con end_consult.',
      );
    this.endConsult(consult, 'visitor_left');
  }

  appendTranscript(
    sessionKey: string,
    role: ConsultTranscriptLine['role'],
    text: string,
  ): void {
    const doorbell = this.doorbells.get(sessionKey);
    const trimmed = text.trim();
    if (!doorbell || !trimmed) {
      return;
    }
    // El mic de la puerta trae ruido y Whisper lo "transcribe" como "Un
    // saludo", "Muchas gracias"…: no se anota ni se le cuenta al dueño.
    if (role === 'visitor' && isLikelyHallucination(trimmed)) {
      return;
    }

    doorbell.transcript.push({ role, text: trimmed, at: new Date().toISOString() });
    this.emit({ type: 'transcript', sessionKey, role, text: trimmed });
    if (doorbell.transcript.length > MAX_TRANSCRIPT_LINES) {
      doorbell.transcript.splice(0, doorbell.transcript.length - MAX_TRANSCRIPT_LINES);
    }

    const consult = doorbell.consultId
      ? this.consults.get(doorbell.consultId)
      : undefined;
    if (consult && this.isActive(consult)) {
      this.broadcastUpdate(consult);
    }
  }

  /**
   * El agente del timbre pide al dueño una decisión: pausa al visitante y
   * anilla la web, o reenvía el dato nuevo si el dueño ya está en llamada.
   */
  callOwner(
    sessionKey: string,
    summary: string,
    options: CallOwnerOptions = {},
  ): CallOwnerResult {
    const doorbell = this.doorbells.get(sessionKey);
    if (!doorbell) {
      throw new BadRequestException('call_owner is only available from the doorbell');
    }
    const trimmed = summary.trim();
    if (!trimmed) {
      throw new BadRequestException('summary is required');
    }

    const existing = doorbell.consultId
      ? this.consults.get(doorbell.consultId)
      : undefined;

    if (existing && this.isActive(existing)) {
      existing.visitorSummary = `${existing.visitorSummary}\nActualización: ${trimmed}`;
      existing.awaitingOwner = true;
      doorbell.controller.pause();

      const owner = this.ownerSessions.get(existing.id);
      if (existing.status === 'answered' && owner) {
        owner.notify(
          `Mensaje nuevo del timbre: ${trimmed}. Cuéntaselo al dueño y pregunta qué responder.`,
        );
      }
      this.broadcastUpdate(existing);

      return {
        status: existing.status === 'answered' ? 'owner_notified' : 'ringing',
        consultId: existing.id,
        message:
          'El dueño ya recibió el dato nuevo. Pide al visitante un momento y espera la instrucción; no inventes la respuesta.',
      };
    }

    this.pruneEnded();

    const now = new Date();
    const ringMs = options.ringMs ?? RING_TIMEOUT_MS;
    const consult: ConsultState = {
      id: randomUUID(),
      sessionKey,
      status: 'ringing',
      visitorSummary: trimmed,
      awaitingOwner: true,
      lastInstruction: null,
      createdAt: now,
      answeredAt: null,
      endedAt: null,
      ringExpiresAt: new Date(now.getTime() + ringMs),
      ringTimer: null,
      greetPending: options.ringFirst ?? false,
      intercom: 'off',
      intercomLink: null,
    };
    consult.ringTimer = setTimeout(() => this.handleNoAnswer(consult.id), ringMs);
    this.consults.set(consult.id, consult);
    doorbell.consultId = consult.id;
    doorbell.controller.pause();

    this.logger.log(`Consult ${consult.id} ringing (doorbell ${sessionKey})`);
    this.emit({ type: 'ringing', consultId: consult.id, sessionKey, summary: trimmed });
    this.broadcastUpdate(consult);

    return {
      status: 'ringing',
      consultId: consult.id,
      message:
        'Se está llamando al dueño. Pide al visitante un momento, en una frase, y luego espera en silencio la instrucción.',
    };
  }

  // ---------------------------------------------------------------------------
  // Dueño (web)
  // ---------------------------------------------------------------------------

  accept(consultId: string, personId: number | null = null): ConsultSnapshot {
    const consult = this.requireConsult(consultId);
    if (consult.status === 'ringing') {
      this.clearRingTimer(consult);
      consult.status = 'answered';
      consult.answeredAt = new Date();
      this.emit({ type: 'answered', consultId, sessionKey: consult.sessionKey, personId });
      this.broadcastUpdate(consult);
    } else if (consult.status !== 'answered') {
      throw new BadRequestException(`Consult is ${consult.status}`);
    }
    return this.toSnapshot(consult);
  }

  decline(consultId: string, personId: number | null = null): ConsultSnapshot {
    const consult = this.requireConsult(consultId);
    if (!this.isActive(consult)) {
      return this.toSnapshot(consult);
    }
    this.emit({ type: 'declined', consultId, sessionKey: consult.sessionKey, personId });
    this.resumeDoorbell(consult, DECLINED_INSTRUCTION);
    this.endConsult(consult, 'declined');
    return this.toSnapshot(consult);
  }

  /**
   * Entrega la decisión del dueño al timbre. Sin `consultId` usa la única
   * consulta activa (p. ej. si el dueño habló por wake word en vez del anillo).
   */
  instruct(consultId: string | undefined, instruction: string): InstructResult {
    const trimmed = instruction.trim();
    if (!trimmed) {
      throw new BadRequestException('instruction is required');
    }

    const consult = this.resolveActive(consultId);
    if (!this.doorbells.has(consult.sessionKey)) {
      this.endConsult(consult, 'visitor_left');
      return { delivered: false, consultId: consult.id, reason: 'visitor_left' };
    }

    if (consult.status === 'ringing') {
      this.accept(consult.id);
    }
    // Si Jarvis va a hablarle al visitante, el interfón se corta primero.
    this.stopIntercom(consult, 'instructed');

    consult.lastInstruction = trimmed;
    consult.awaitingOwner = false;
    this.resumeDoorbell(
      consult,
      `Instrucción del dueño para el visitante: ${trimmed}. Transmítela ahora al visitante con tus palabras.`,
    );
    this.broadcastUpdate(consult);
    return { delivered: true, consultId: consult.id };
  }

  close(consultId: string | undefined): ConsultSnapshot {
    const consult = consultId
      ? this.requireConsult(consultId)
      : this.resolveActive(undefined);
    if (!this.isActive(consult)) {
      return this.toSnapshot(consult);
    }
    if (consult.awaitingOwner) {
      this.resumeDoorbell(consult, CLOSED_INSTRUCTION);
    }
    this.endConsult(consult, 'closed');
    return this.toSnapshot(consult);
  }

  // ---------------------------------------------------------------------------
  // Interfón: el dueño habla directo con el visitante
  // ---------------------------------------------------------------------------

  /**
   * Pide el interfón (botón "Hablar directo" o "pásamelo" por voz). La web del
   * dueño ve `intercom: 'requested'` y abre `/intercom`.
   */
  requestIntercom(consultId: string | undefined): InstructResult {
    const consult = this.resolveActive(consultId);
    if (!this.doorbells.has(consult.sessionKey)) {
      this.endConsult(consult, 'visitor_left');
      return {
        delivered: false,
        consultId: consult.id,
        reason: 'visitor_left',
      };
    }
    if (consult.status === 'ringing') {
      this.accept(consult.id);
    }
    if (consult.intercom === 'off') {
      consult.intercom = 'requested';
      this.logger.log(`Consult ${consult.id} intercom requested`);
      this.broadcastUpdate(consult);
    }
    return { delivered: true, consultId: consult.id };
  }

  /**
   * Conecta el socket `/intercom` del dueño. Solo se acepta si la consulta
   * pidió el interfón: el id (UUID) más ese estado hacen de candado.
   */
  attachIntercom(consultId: string, link: OwnerIntercomLink): boolean {
    const consult = this.consults.get(consultId);
    const doorbell = consult
      ? this.doorbells.get(consult.sessionKey)
      : undefined;
    if (
      !consult ||
      !doorbell ||
      !this.isActive(consult) ||
      consult.intercom !== 'requested'
    ) {
      return false;
    }

    consult.intercomLink = link;
    consult.intercom = 'connecting';
    consult.awaitingOwner = false;
    link.sendState('connecting');
    this.broadcastUpdate(consult);

    doorbell.controller.startIntercom(
      (pcm16k) => link.sendAudio(pcm16k),
      INTERCOM_HANDOFF_INSTRUCTION,
      () => {
        if (consult.intercomLink !== link) {
          return;
        }
        consult.intercom = 'on';
        link.sendState('on');
        this.emit({ type: 'intercom', consultId: consult.id, sessionKey: consult.sessionKey });
        this.logger.log(`Consult ${consult.id} intercom on`);
        this.broadcastUpdate(consult);
      },
    );
    return true;
  }

  /** Voz del dueño hacia la puerta (ya filtrada por la compuerta de voz). */
  ownerAudio(consultId: string, link: OwnerIntercomLink, pcm16k: Buffer): void {
    const consult = this.consults.get(consultId);
    if (
      !consult ||
      consult.intercomLink !== link ||
      consult.intercom !== 'on'
    ) {
      return;
    }
    this.doorbells.get(consult.sessionKey)?.controller.sendToVisitor(pcm16k);
  }

  ownerTalking(
    consultId: string,
    link: OwnerIntercomLink,
    talking: boolean,
  ): void {
    const consult = this.consults.get(consultId);
    if (!consult || consult.intercomLink !== link) {
      return;
    }
    this.doorbells.get(consult.sessionKey)?.controller.setOwnerTalking(talking);
  }

  /**
   * Termina el interfón. `ai`: el visitante queda en espera y Jarvis retoma con
   * el dueño. `close`: se cierra la consulta y el timbre se despide.
   */
  detachIntercom(
    consultId: string,
    link: OwnerIntercomLink,
    then: 'ai' | 'close',
  ): void {
    const consult = this.consults.get(consultId);
    if (!consult || consult.intercomLink !== link) {
      return;
    }
    this.stopIntercom(consult, null);
    if (!this.isActive(consult)) {
      return;
    }

    if (then === 'close') {
      this.resumeDoorbell(consult, INTERCOM_CLOSED_INSTRUCTION);
      this.endConsult(consult, 'closed');
      return;
    }

    consult.awaitingOwner = true;
    this.ownerSessions.get(consult.id)?.notify(INTERCOM_BACK_TO_OWNER);
    this.broadcastUpdate(consult);
  }

  registerOwnerSession(consultId: string, controller: OwnerSessionController): void {
    this.ownerSessions.set(consultId, controller);
  }

  /** La llamada web del dueño terminó; si nadie decidió, el timbre toma recado. */
  unregisterOwnerSession(consultId: string, controller: OwnerSessionController): void {
    if (this.ownerSessions.get(consultId) !== controller) {
      return;
    }
    this.ownerSessions.delete(consultId);

    const consult = this.consults.get(consultId);
    if (!consult || consult.status !== 'answered') {
      return;
    }
    // Colgar a Jarvis mientras hablas directo no corta la plática con el visitante.
    if (consult.intercom !== 'off') {
      return;
    }
    if (consult.awaitingOwner) {
      this.resumeDoorbell(consult, OWNER_LEFT_INSTRUCTION);
    }
    this.endConsult(consult, 'closed');
  }

  // ---------------------------------------------------------------------------
  // Contexto para prompts
  // ---------------------------------------------------------------------------

  getSnapshot(consultId: string): ConsultSnapshot {
    return this.toSnapshot(this.requireConsult(consultId));
  }

  listActive(): ConsultSnapshot[] {
    return [...this.consults.values()]
      .filter((consult) => this.isActive(consult))
      .map((consult) => this.toSnapshot(consult));
  }

  /** Resumen de la consulta para la sesión `security` del dueño. */
  buildOwnerContext(consultId: string): string {
    const snapshot = this.getSnapshot(consultId);
    return [
      'Consulta activa del timbre:',
      `Resumen del agente del timbre: ${snapshot.visitorSummary}`,
      this.formatTranscript(snapshot.transcript),
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Aviso para la sesión normal de Jarvis si hay alguien esperando en la puerta. */
  buildActiveContextSummary(): string {
    const active = this.listActive();
    if (active.length === 0) {
      return '';
    }
    const lines = active.map(
      (consult) =>
        `- Consulta ${consult.id} (${consult.status}): ${consult.visitorSummary}`,
    );
    return [
      'Hay alguien en el timbre esperando al dueño:',
      ...lines,
      'Si el usuario te dice qué contestarle, llama instruct_doorbell; si quiere hablar él mismo con el visitante, connect_visitor; cuando termine, end_consult.',
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Navegadores conectados a /consult
  // ---------------------------------------------------------------------------

  /** Hay al menos una pestaña de la app abierta (alguien que pueda contestar). */
  hasViewers(): boolean {
    for (const client of this.viewers) {
      if (client.readyState === WebSocket.OPEN) {
        return true;
      }
    }
    return false;
  }

  addViewer(client: WebSocket): void {
    this.viewers.add(client);
    this.sendTo(client, { type: 'consult.snapshot', consults: this.listActive() });
  }

  removeViewer(client: WebSocket): void {
    this.viewers.delete(client);
    this.viewerPeople.delete(client);
  }

  /** El gateway ya validó la sesión: recuerda quién está detrás del socket. */
  setViewerPerson(client: WebSocket, personId: number): void {
    this.viewerPeople.set(client, personId);
  }

  handleViewerMessage(client: WebSocket, raw: string): void {
    const message = this.parseClientMessage(raw);
    if (!message) {
      return;
    }
    try {
      const personId = this.viewerPeople.get(client) ?? null;
      if (message.type === 'consult.accept') {
        this.accept(message.consultId, personId);
      } else if (message.type === 'consult.intercom.start') {
        this.requestIntercom(message.consultId);
      } else if (message.type === 'consult.decline') {
        this.decline(message.consultId, personId);
      } else {
        this.close(message.consultId);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : 'consult error';
      this.logger.warn(`Viewer ${message.type} failed: ${text}`);
      const consult = this.consults.get(message.consultId);
      if (consult) {
        this.sendTo(client, { type: 'consult.update', consult: this.toSnapshot(consult) });
      }
    }
  }

  onModuleDestroy(): void {
    for (const consult of this.consults.values()) {
      this.clearRingTimer(consult);
    }
  }

  // ---------------------------------------------------------------------------
  // Internos
  // ---------------------------------------------------------------------------

  private handleNoAnswer(consultId: string): void {
    const consult = this.consults.get(consultId);
    if (!consult || consult.status !== 'ringing') {
      return;
    }
    this.logger.log(`Consult ${consultId} missed`);
    this.resumeDoorbell(consult, NO_ANSWER_INSTRUCTION);
    this.endConsult(consult, 'missed');
  }

  private resumeDoorbell(consult: ConsultState, instruction: string): void {
    consult.awaitingOwner = false;
    let text = instruction;
    if (consult.greetPending) {
      // El timbre sonó primero: la IA aún no le ha dicho nada al visitante.
      consult.greetPending = false;
      text = `${RING_FIRST_GREETING} ${instruction}`;
    }
    this.doorbells.get(consult.sessionKey)?.controller.resume(text);
  }

  /** Corta el interfón; `reason` cierra también el socket del dueño. */
  private stopIntercom(consult: ConsultState, reason: string | null): void {
    if (consult.intercom === 'off') {
      return;
    }
    const link = consult.intercomLink;
    consult.intercom = 'off';
    consult.intercomLink = null;
    this.doorbells
      .get(consult.sessionKey)
      ?.controller.stopIntercom(INTERCOM_DOORBELL_NOTE);
    if (link && reason) {
      link.close(reason);
    }
    this.logger.log(`Consult ${consult.id} intercom off`);
  }

  private endConsult(consult: ConsultState, status: ConsultStatus): void {
    this.stopIntercom(consult, status);
    this.clearRingTimer(consult);
    consult.status = status;
    consult.awaitingOwner = false;
    consult.endedAt = new Date();

    const doorbell = this.doorbells.get(consult.sessionKey);
    if (doorbell?.consultId === consult.id) {
      doorbell.consultId = null;
    }
    this.logger.log(`Consult ${consult.id} ended: ${status}`);
    if (status !== 'answered' && status !== 'ringing') {
      this.emit({ type: 'ended', consultId: consult.id, sessionKey: consult.sessionKey, status });
    }
    this.broadcastUpdate(consult);
  }

  private resolveActive(consultId: string | undefined): ConsultState {
    if (consultId) {
      const consult = this.requireConsult(consultId);
      if (!this.isActive(consult)) {
        throw new BadRequestException(`Consult is ${consult.status}`);
      }
      return consult;
    }

    const active = [...this.consults.values()].filter((consult) =>
      this.isActive(consult),
    );
    if (active.length === 0) {
      throw new NotFoundException('No hay nadie esperando en el timbre');
    }
    return active.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  private requireConsult(consultId: string): ConsultState {
    const consult = this.consults.get(consultId);
    if (!consult) {
      throw new NotFoundException(`Consult not found: ${consultId}`);
    }
    return consult;
  }

  private isActive(consult: ConsultState): boolean {
    return ACTIVE_CONSULT_STATUSES.includes(consult.status);
  }

  private clearRingTimer(consult: ConsultState): void {
    if (consult.ringTimer) {
      clearTimeout(consult.ringTimer);
      consult.ringTimer = null;
    }
    consult.ringExpiresAt = null;
  }

  private pruneEnded(): void {
    const cutoff = Date.now() - ENDED_RETENTION_MS;
    for (const [id, consult] of this.consults) {
      if (consult.endedAt && consult.endedAt.getTime() < cutoff) {
        this.consults.delete(id);
      }
    }
  }

  private toSnapshot(consult: ConsultState): ConsultSnapshot {
    return {
      id: consult.id,
      status: consult.status,
      visitorSummary: consult.visitorSummary,
      awaitingOwner: consult.awaitingOwner,
      lastInstruction: consult.lastInstruction,
      intercom: consult.intercom,
      transcript: [...(this.doorbells.get(consult.sessionKey)?.transcript ?? [])],
      createdAt: consult.createdAt.toISOString(),
      answeredAt: consult.answeredAt?.toISOString() ?? null,
      endedAt: consult.endedAt?.toISOString() ?? null,
      ringExpiresAt: consult.ringExpiresAt?.toISOString() ?? null,
    };
  }

  private formatTranscript(lines: ConsultTranscriptLine[]): string {
    if (lines.length === 0) {
      return '';
    }
    const body = lines
      .slice(-16)
      .map((line) => `${line.role === 'visitor' ? 'Visitante' : 'Timbre'}: ${line.text}`)
      .join('\n');
    return `Conversación reciente en la puerta:\n${body}`;
  }

  private broadcastUpdate(consult: ConsultState): void {
    const message: ConsultServerMessage = {
      type: 'consult.update',
      consult: this.toSnapshot(consult),
    };
    for (const client of this.viewers) {
      this.sendTo(client, message);
    }
  }

  private sendTo(client: WebSocket, message: ConsultServerMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  private parseClientMessage(raw: string): ConsultClientMessage | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const { type, consultId } = parsed as { type?: unknown; consultId?: unknown };
    if (
      (type === 'consult.accept' ||
        type === 'consult.decline' ||
        type === 'consult.close' ||
        type === 'consult.intercom.start') &&
      typeof consultId === 'string' &&
      consultId.length > 0
    ) {
      return { type, consultId };
    }
    return null;
  }
}
