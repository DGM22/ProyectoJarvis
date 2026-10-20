import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import WebSocket from 'ws';
import { AuthService } from '../auth/auth.service';
import { ConsultService } from './consult.service';
import type { IntercomState, OwnerIntercomLink } from './consult.types';
import { OwnerVoiceGate, type GateMode } from './owner-voice-gate';
import { VisitorNoiseGate } from './visitor-noise-gate';

type IntercomClientMessage =
  | { type: 'mode'; mode: GateMode }
  | { type: 'ptt'; on: boolean }
  | { type: 'mute'; on: boolean }
  | { type: 'stop'; then: 'ai' | 'close' };

interface IntercomSession {
  consultId: string;
  link: OwnerIntercomLink;
  gate: OwnerVoiceGate;
  /** Sobrante de un frame binario que no llegó par (PCM16 = 2 bytes). */
  carry: Buffer | null;
}

/**
 * WebSocket `/intercom?consultId=…`: el dueño habla directo con el visitante.
 *
 * Binario en ambos sentidos: PCM16 LE mono 16 kHz (el mismo formato que la
 * bocina del ESP32). JSON para control: modo auto / mantener para hablar,
 * mute y terminar. Solo se acepta si la consulta pidió el interfón.
 */
@WebSocketGateway({ path: '/intercom', cors: true })
export class IntercomGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(IntercomGateway.name);
  private readonly sessions = new Map<WebSocket, IntercomSession>();

  constructor(
    private readonly consultService: ConsultService,
    private readonly authService: AuthService,
  ) {}

  async handleConnection(client: WebSocket, req: IncomingMessage): Promise<void> {
    // Hablar por la bocina de la puerta exige sesión, además del candado de
    // la consulta (que haya pedido el interfón).
    if (!(await this.authService.userFromRequest(req))) {
      client.close(4401, 'Unauthorized');
      return;
    }
    const consultId = this.extractConsultId(req);
    // Voz del visitante → dueño: sin siseo ni ráfagas de ruido del mic.
    const visitorGate = new VisitorNoiseGate((report) =>
      this.logger.log(
        `Intercom ${consultId} mic puerta: ${report.frames} frames, voz ${report.voicePct}%, ` +
          `rms ${report.avgRmsDbfs.toFixed(1)} dBFS, ruido ${report.avgDiffRatio.toFixed(2)} ` +
          `(voz < 1.05, ruido blanco ≈ 1.4)`,
      ),
    );
    const link: OwnerIntercomLink = {
      sendAudio: (pcm16k) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(visitorGate.process(pcm16k), { binary: true });
        }
      },
      sendState: (state: IntercomState) =>
        this.sendJson(client, { type: 'intercom.state', state }),
      close: (reason) => {
        this.sessions.delete(client);
        this.sendJson(client, { type: 'intercom.ended', reason });
        client.close(1000, reason.slice(0, 120));
      },
    };

    if (!consultId || !this.consultService.attachIntercom(consultId, link)) {
      this.logger.warn(
        `Rejected intercom for consult ${consultId ?? '(none)'}`,
      );
      client.close(4403, 'Intercom not requested');
      return;
    }

    const session: IntercomSession = {
      consultId,
      link,
      gate: new OwnerVoiceGate(),
      carry: null,
    };
    this.sessions.set(client, session);
    this.logger.log(`Intercom connected for consult ${consultId}`);

    client.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      const current = this.sessions.get(client);
      if (!current) {
        return;
      }
      if (isBinary) {
        this.handleAudio(client, current, this.toBuffer(data));
      } else {
        this.handleControl(
          client,
          current,
          this.toBuffer(data).toString('utf8'),
        );
      }
    });
  }

  handleDisconnect(client: WebSocket): void {
    const session = this.sessions.get(client);
    this.sessions.delete(client);
    if (!session) {
      return;
    }
    // Se cayó la web del dueño: el visitante vuelve a quedar en espera.
    this.consultService.detachIntercom(session.consultId, session.link, 'ai');
    this.logger.log(`Intercom disconnected for consult ${session.consultId}`);
  }

  private handleAudio(
    client: WebSocket,
    session: IntercomSession,
    data: Buffer,
  ): void {
    let frame = session.carry ? Buffer.concat([session.carry, data]) : data;
    session.carry = null;
    if (frame.length & 1) {
      session.carry = frame.subarray(frame.length - 1);
      frame = frame.subarray(0, frame.length - 1);
    }
    if (frame.length === 0) {
      return;
    }

    const { forward, changed } = session.gate.process(frame);
    if (changed) {
      const talking = session.gate.isOpen;
      this.consultService.ownerTalking(
        session.consultId,
        session.link,
        talking,
      );
      this.sendJson(client, { type: 'owner.talking', on: talking });
    }
    for (const chunk of forward) {
      this.consultService.ownerAudio(session.consultId, session.link, chunk);
    }
  }

  private handleControl(
    client: WebSocket,
    session: IntercomSession,
    raw: string,
  ): void {
    const message = this.parseControl(raw);
    if (!message) {
      return;
    }
    switch (message.type) {
      case 'mode':
        session.gate.setMode(message.mode);
        break;
      case 'ptt':
        session.gate.setPtt(message.on);
        break;
      case 'mute':
        session.gate.setMuted(message.on);
        break;
      case 'stop':
        this.sessions.delete(client);
        this.consultService.detachIntercom(
          session.consultId,
          session.link,
          message.then,
        );
        this.sendJson(client, { type: 'intercom.ended', reason: message.then });
        client.close(1000, 'stopped');
        break;
    }
  }

  private parseControl(raw: string): IntercomClientMessage | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const message = parsed as Record<string, unknown>;
    if (
      message.type === 'mode' &&
      (message.mode === 'auto' || message.mode === 'ptt')
    ) {
      return { type: 'mode', mode: message.mode };
    }
    if (
      (message.type === 'ptt' || message.type === 'mute') &&
      typeof message.on === 'boolean'
    ) {
      return { type: message.type, on: message.on };
    }
    if (
      message.type === 'stop' &&
      (message.then === 'ai' || message.then === 'close')
    ) {
      return { type: 'stop', then: message.then };
    }
    return null;
  }

  private extractConsultId(req: IncomingMessage): string | null {
    try {
      const url = new URL(
        req.url ?? '/',
        `http://${req.headers.host ?? 'localhost'}`,
      );
      const id = url.searchParams.get('consultId');
      return id && id.length <= 64 ? id : null;
    } catch {
      return null;
    }
  }

  private toBuffer(data: WebSocket.RawData): Buffer {
    if (Buffer.isBuffer(data)) {
      return data;
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data);
    }
    return Buffer.from(data);
  }

  private sendJson(client: WebSocket, message: Record<string, unknown>): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}
