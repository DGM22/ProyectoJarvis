import { Injectable, Logger } from '@nestjs/common';
import type { OwnerIntercomLink } from '../consult/consult.types';
import { InteractionsService } from '../home/interactions.service';
import { RealtimeWsBridgeService } from '../realtime/realtime-ws-bridge.service';
import { DevicesRegistryService } from './devices-registry.service';
import { DevicesService } from './devices.service';

export type LiveStartResult =
  | { ok: true }
  | { ok: false; code: 4404 | 4409; reason: string };

interface LiveSession {
  link: OwnerIntercomLink;
  /** Quién abrió la sesión (para el historial). */
  personName: string;
}

/**
 * Hablar con la puerta sin que toquen (tipo Ring): el dueño abre `/live` y su
 * micrófono suena en la bocina del dispositivo, y lo que oye el micrófono de
 * la puerta llega a su navegador. No interviene ninguna IA ni consulta.
 *
 * Reusa el protocolo de audio de la placa (PCM16 16 kHz por `/devices`): se le
 * manda `intercom.start` (baja latencia) y `session.ready`, igual que en una
 * llamada normal, así que el firmware no necesita cambios.
 */
@Injectable()
export class LiveSessionService {
  private readonly logger = new Logger(LiveSessionService.name);
  private readonly sessions = new Map<number, LiveSession>();

  constructor(
    private readonly registry: DevicesRegistryService,
    private readonly devicesService: DevicesService,
    private readonly realtimeBridge: RealtimeWsBridgeService,
    private readonly interactions: InteractionsService,
  ) {}

  isLive(deviceId: number): boolean {
    return this.sessions.has(deviceId);
  }

  async start(
    deviceId: number,
    link: OwnerIntercomLink,
    personName: string,
  ): Promise<LiveStartResult> {
    if (!this.registry.isOnline(deviceId)) {
      return { ok: false, code: 4404, reason: 'La puerta no está conectada' };
    }
    if (this.sessions.has(deviceId)) {
      return { ok: false, code: 4409, reason: 'Alguien más ya está hablando con la puerta' };
    }
    const bridgeKey = this.registry.getBridgeKey(deviceId);
    if (bridgeKey && this.realtimeBridge.isInCall(bridgeKey)) {
      return { ok: false, code: 4409, reason: 'Hay una visita en la puerta ahora mismo' };
    }

    this.sessions.set(deviceId, { link, personName });
    this.registry.send(deviceId, { type: 'intercom.start' });
    this.registry.send(deviceId, { type: 'session.ready', reason: 'inbound' });
    this.registry.send(deviceId, { type: 'display.set', state: 'listening' });
    await this.devicesService.markStatus(deviceId, 'in_call');
    link.sendState('on');
    this.logger.log(`Live session on device ${deviceId} (${personName})`);
    void this.interactions.recordLiveSession(deviceId, personName);
    return { ok: true };
  }

  /** Micrófono de la puerta → navegador del dueño. */
  deviceAudio(deviceId: number, pcm16k: Buffer): void {
    this.sessions.get(deviceId)?.link.sendAudio(pcm16k);
  }

  /** Voz del dueño → bocina de la puerta (ya pasó por la compuerta de voz). */
  ownerAudio(deviceId: number, link: OwnerIntercomLink, pcm16k: Buffer): void {
    if (this.sessions.get(deviceId)?.link === link) {
      this.registry.sendBinary(deviceId, pcm16k);
    }
  }

  /** El ESP32 silencia su mic con `speaking`: así no regresa la voz del dueño. */
  ownerTalking(deviceId: number, link: OwnerIntercomLink, talking: boolean): void {
    if (this.sessions.get(deviceId)?.link === link) {
      this.registry.send(deviceId, {
        type: 'display.set',
        state: talking ? 'speaking' : 'listening',
      });
    }
  }

  /** El dueño cuelga (o se le cayó el navegador). */
  stop(deviceId: number, link: OwnerIntercomLink): void {
    if (this.sessions.get(deviceId)?.link !== link) {
      return;
    }
    this.finish(deviceId);
  }

  /**
   * Termina desde el lado de la puerta o del servidor: alguien tocó el
   * timbre, el visitante colgó con el botón o el dispositivo se desconectó.
   */
  endByDevice(deviceId: number, reason: string): void {
    const session = this.sessions.get(deviceId);
    if (!session) {
      return;
    }
    this.finish(deviceId);
    session.link.close(reason);
  }

  private finish(deviceId: number): void {
    this.sessions.delete(deviceId);
    this.registry.send(deviceId, { type: 'intercom.end' });
    this.registry.send(deviceId, { type: 'session.end', reason: 'live_end' });
    this.registry.send(deviceId, { type: 'display.set', state: 'idle' });
    void this.devicesService.markStatus(deviceId, 'idle').catch(() => undefined);
    this.logger.log(`Live session ended on device ${deviceId}`);
  }
}
