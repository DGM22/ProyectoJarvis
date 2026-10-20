import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import WebSocket from 'ws';
import { AuthService } from '../auth/auth.service';
import type { IntercomState, OwnerIntercomLink } from '../consult/consult.types';
import { OwnerVoiceGate, type GateMode } from '../consult/owner-voice-gate';
import { VisitorNoiseGate } from '../consult/visitor-noise-gate';
import { LiveSessionService } from './live-session.service';

type LiveClientMessage =
  | { type: 'mode'; mode: GateMode }
  | { type: 'ptt'; on: boolean }
  | { type: 'mute'; on: boolean }
  | { type: 'stop' };

interface LiveClient {
  deviceId: number;
  link: OwnerIntercomLink;
  gate: OwnerVoiceGate;
  /** Sobrante de un frame binario que no llegó par (PCM16 = 2 bytes). */
  carry: Buffer | null;
}

/**
 * WebSocket `/live?deviceId=…`: ver y hablar con la puerta sin que toquen.
 *
 * Mismo protocolo que `/intercom` (PCM16 16 kHz binario + JSON de control), y
 * mismas compuertas de voz: la del dueño (half-duplex) y la de ruido del mic
 * de la puerta. Exige sesión.
 */
@WebSocketGateway({ path: '/live', cors: true })
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveGateway.name);
  private readonly clients = new Map<WebSocket, LiveClient>();

  constructor(
    private readonly live: LiveSessionService,
    private readonly authService: AuthService,
  ) {}

  async handleConnection(client: WebSocket, req: IncomingMessage): Promise<void> {
    const user = await this.authService.userFromRequest(req);
    if (!user) {
      client.close(4401, 'Unauthorized');
      return;
    }
    const deviceId = this.extractDeviceId(req);
    if (deviceId === null) {
      client.close(4400, 'deviceId requerido');
      return;
    }

    const visitorGate = new VisitorNoiseGate();
    const link: OwnerIntercomLink = {
      sendAudio: (pcm16k) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(visitorGate.process(pcm16k), { binary: true });
        }
      },
      sendState: (state: IntercomState) => this.sendJson(client, { type: 'intercom.state', state }),
      close: (reason) => {
        this.clients.delete(client);
        this.sendJson(client, { type: 'intercom.ended', reason });
        client.close(1000, reason.slice(0, 120));
      },
    };

    const result = await this.live.start(deviceId, link, user.name);
    if (!result.ok) {
      this.logger.warn(`Live rejected for device ${deviceId}: ${result.reason}`);
      client.close(result.code, result.reason);
      return;
    }
    // El navegador pudo cerrarse mientras se abría la sesión.
    if (client.readyState !== WebSocket.OPEN) {
      this.live.stop(deviceId, link);
      return;
    }

    this.clients.set(client, { deviceId, link, gate: new OwnerVoiceGate(), carry: null });
    client.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      const current = this.clients.get(client);
      if (!current) return;
      if (isBinary) {
        this.handleAudio(client, current, this.toBuffer(data));
      } else {
        this.handleControl(client, current, this.toBuffer(data).toString('utf8'));
      }
    });
  }

  handleDisconnect(client: WebSocket): void {
    const current = this.clients.get(client);
    this.clients.delete(client);
    if (current) {
      this.live.stop(current.deviceId, current.link);
    }
  }

  private handleAudio(client: WebSocket, current: LiveClient, data: Buffer): void {
    let frame = current.carry ? Buffer.concat([current.carry, data]) : data;
    current.carry = null;
    if (frame.length & 1) {
      current.carry = frame.subarray(frame.length - 1);
      frame = frame.subarray(0, frame.length - 1);
    }
    if (frame.length === 0) return;

    const { forward, changed } = current.gate.process(frame);
    if (changed) {
      const talking = current.gate.isOpen;
      this.live.ownerTalking(current.deviceId, current.link, talking);
      this.sendJson(client, { type: 'owner.talking', on: talking });
    }
    for (const chunk of forward) {
      this.live.ownerAudio(current.deviceId, current.link, chunk);
    }
  }

  private handleControl(client: WebSocket, current: LiveClient, raw: string): void {
    const message = this.parseControl(raw);
    if (!message) return;
    switch (message.type) {
      case 'mode':
        current.gate.setMode(message.mode);
        break;
      case 'ptt':
        current.gate.setPtt(message.on);
        break;
      case 'mute':
        current.gate.setMuted(message.on);
        break;
      case 'stop':
        this.clients.delete(client);
        this.live.stop(current.deviceId, current.link);
        this.sendJson(client, { type: 'intercom.ended', reason: 'stopped' });
        client.close(1000, 'stopped');
        break;
    }
  }

  private parseControl(raw: string): LiveClientMessage | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const message = parsed as Record<string, unknown>;
    if (message.type === 'mode' && (message.mode === 'auto' || message.mode === 'ptt')) {
      return { type: 'mode', mode: message.mode };
    }
    if ((message.type === 'ptt' || message.type === 'mute') && typeof message.on === 'boolean') {
      return { type: message.type, on: message.on };
    }
    return message.type === 'stop' ? { type: 'stop' } : null;
  }

  private extractDeviceId(req: IncomingMessage): number | null {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const value = Number(url.searchParams.get('deviceId'));
      return Number.isInteger(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }

  private toBuffer(data: WebSocket.RawData): Buffer {
    if (Buffer.isBuffer(data)) return data;
    if (Array.isArray(data)) return Buffer.concat(data);
    return Buffer.from(data);
  }

  private sendJson(client: WebSocket, message: Record<string, unknown>): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}
