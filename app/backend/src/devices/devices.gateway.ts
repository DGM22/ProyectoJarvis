import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import {
  RealtimeWsBridgeService,
  type DeviceDisplayState,
} from '../realtime/realtime-ws-bridge.service';
import {
  parseDeviceMessage,
  type DeviceSessionReason,
  type ServerToDeviceMessage,
} from './device-protocol';
import { DevicesRegistryService } from './devices-registry.service';
import { DevicesService } from './devices.service';
import { InteractionsService } from '../home/interactions.service';
import { LiveSessionService } from './live-session.service';
import { AttentionService } from '../home/attention.service';
import { ConsultService } from '../consult/consult.service';

let connectionCounter = 0;

/**
 * Gateway WebSocket `/devices` para thin clients ESP32.
 *
 * Autenticación por Bearer token (header o `?token=`). Control en JSON; audio
 * PCM16LE 16 kHz mono en frames binarios.
 */
@WebSocketGateway({ path: '/devices' })
export class DevicesGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(DevicesGateway.name);
  private readonly bridgeKeys = new Map<WebSocket, string>();
  private readonly deviceIds = new Map<WebSocket, number>();

  constructor(
    private readonly devicesService: DevicesService,
    private readonly registry: DevicesRegistryService,
    private readonly realtimeBridge: RealtimeWsBridgeService,
    private readonly interactions: InteractionsService,
    private readonly live: LiveSessionService,
    private readonly attention: AttentionService,
    private readonly consultService: ConsultService,
  ) {}

  /**
   * Autentica el dispositivo y espera el `hello` inicial.
   *
   * @param client Socket del ESP32.
   * @param req Petición de upgrade HTTP.
   */
  async handleConnection(
    client: WebSocket,
    req: IncomingMessage,
  ): Promise<void> {
    const token = this.extractToken(req);
    const device = token ? await this.devicesService.authenticate(token) : null;

    if (!device) {
      this.logger.warn('Rejected device connection: invalid token');
      client.close(4401, 'Unauthorized');
      return;
    }

    const bridgeKey = `dev-${device.id}-${++connectionCounter}`;
    this.bridgeKeys.set(client, bridgeKey);
    this.deviceIds.set(client, device.id);
    this.registry.register(device.id, client, bridgeKey);

    await this.devicesService.markStatus(device.id, 'idle');
    this.logger.log(`Device connected: ${device.id} (${device.name})`);

    client.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      void this.handleMessage(client, data, isBinary);
    });
  }

  /**
   * Marca offline y cierra cualquier sesión Realtime asociada.
   *
   * @param client Socket del dispositivo.
   */
  async handleDisconnect(client: WebSocket): Promise<void> {
    const bridgeKey = this.bridgeKeys.get(client);
    const deviceId = this.deviceIds.get(client);

    if (deviceId !== undefined) {
      this.live.endByDevice(deviceId, 'La puerta se desconectó');
    }
    if (bridgeKey && this.realtimeBridge.isInCall(bridgeKey)) {
      this.realtimeBridge.end(bridgeKey, 'device_disconnect');
    }

    this.registry.unregister(client);
    this.bridgeKeys.delete(client);
    this.deviceIds.delete(client);

    if (deviceId) {
      await this.devicesService.markStatus(deviceId, 'offline');
      this.logger.log(`Device disconnected: ${deviceId}`);
    }
  }

  /**
   * Inicia una llamada saliente hacia un dispositivo online (desde HTTP).
   *
   * @param deviceId Identificador del dispositivo.
   * @param prompt Instrucciones para Jarvis al contestar.
   * @param voice Voz opcional.
   */
  async startInboundCall(
    deviceId: number,
    prompt: string,
    voice?: string,
  ): Promise<boolean> {
    const live = this.registry.get(deviceId);
    if (!live || live.socket.readyState !== live.socket.OPEN) {
      return false;
    }

    const sent = this.registry.send(deviceId, {
      type: 'inbound.start',
      prompt,
      voice,
    });
    if (!sent) {
      return false;
    }

    // El servidor abre Realtime; el firmware solo prepara audio al recibir inbound.start.
    await this.beginSession(live.socket, 'inbound', voice, prompt);
    return true;
  }

  private async handleMessage(
    client: WebSocket,
    data: WebSocket.RawData,
    isBinary: boolean,
  ): Promise<void> {
    const bridgeKey = this.bridgeKeys.get(client);
    const deviceId = this.deviceIds.get(client);
    if (!bridgeKey || !deviceId) {
      return;
    }

    if (isBinary) {
      const pcm = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer);
      // En vista en vivo el micrófono de la puerta va al dueño, no a OpenAI.
      if (this.live.isLive(deviceId)) {
        this.live.deviceAudio(deviceId, pcm);
        return;
      }
      this.realtimeBridge.appendInputAudio(bridgeKey, pcm);
      return;
    }

    const raw =
      typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Buffer.from(data as ArrayBuffer).toString('utf8');

    const message = parseDeviceMessage(raw);
    if (!message) {
      this.send(client, {
        type: 'error',
        message: 'Invalid control message',
      });
      return;
    }

    if (message.type === 'hello') {
      await this.devicesService.markStatus(deviceId, 'idle', {
        firmwareVersion: message.firmwareVersion,
      });
      const device = await this.devicesService.findById(deviceId);
      this.send(client, {
        type: 'hello.ack',
        deviceId: device.id,
        name: device.name,
        serverTime: new Date().toISOString(),
      });
      this.send(client, { type: 'display.set', state: 'idle' });
      return;
    }

    if (message.type === 'session.request') {
      // Un visitante que toca tiene prioridad sobre la vista en vivo del dueño.
      this.live.endByDevice(deviceId, 'Alguien tocó el timbre');
      await this.beginSession(client, message.reason, message.voice, undefined);
      return;
    }

    if (message.type === 'session.end') {
      if (this.live.isLive(deviceId)) {
        // El botón físico en vista en vivo = tocar el timbre, no colgar.
        this.live.endByDevice(deviceId, 'Alguien tocó el timbre');
        if (message.reason === 'button') {
          await this.beginSession(client, 'button', undefined, undefined);
        }
        return;
      }
      this.realtimeBridge.end(bridgeKey, message.reason ?? 'client_end');
      await this.devicesService.markStatus(deviceId, 'idle');
      return;
    }

    if (message.type === 'telemetry') {
      // Stub: aceptamos telemetría para no romper el protocolo futuro.
      this.logger.debug(
        `Telemetry from device ${deviceId}: ${message.sensor}=${message.value}`,
      );
    }
  }

  private async beginSession(
    client: WebSocket,
    reason: DeviceSessionReason,
    voice?: string,
    inboundPrompt?: string,
  ): Promise<void> {
    const bridgeKey = this.bridgeKeys.get(client);
    const deviceId = this.deviceIds.get(client);
    if (!bridgeKey || !deviceId) {
      return;
    }

    if (this.realtimeBridge.isInCall(bridgeKey)) {
      this.send(client, {
        type: 'error',
        message: 'Already in a call',
      });
      return;
    }

    // El modo de atención se decide al inicio y queda anotado en la visita.
    const attention = await this.resolveAttention(reason);
    const note = !attention
      ? undefined
      : !attention.ownerAvailable
        ? 'no molestar'
        : attention.ringFirst
          ? 'sonó primero'
          : undefined;
    // Cada sesión del dispositivo queda en el historial de visitas.
    await this.interactions.startVisit(bridgeKey, deviceId, reason, note);

    try {
      await this.realtimeBridge.start(
        bridgeKey,
        {
          onAudioOut: (pcm16k) => {
            if (client.readyState === client.OPEN) {
              client.send(pcm16k);
            }
          },
          onDisplay: (state: DeviceDisplayState) => {
            this.send(client, { type: 'display.set', state });
          },
          onSessionReady: () => {
            this.send(client, { type: 'session.ready', reason });
          },
          onSessionEnd: (endReason) => {
            this.send(client, { type: 'session.end', reason: endReason });
            void this.devicesService.markStatus(deviceId, 'idle');
            void this.interactions.endVisit(bridgeKey);
          },
          onError: (message) => {
            void this.interactions.recordError(deviceId, bridgeKey, 'realtime', message);
            this.send(client, { type: 'error', message });
            this.send(client, { type: 'display.set', state: 'error' });
          },
          onControl: (message) => {
            this.send(client, message);
          },
        },
        {
          reason,
          voice,
          inboundPrompt,
          attention,
        },
      );
      await this.devicesService.markStatus(deviceId, 'in_call');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to start session';
      await this.interactions.recordError(deviceId, bridgeKey, 'session_start', message);
      await this.interactions.endVisit(bridgeKey);
      this.send(client, { type: 'error', message });
      this.send(client, { type: 'display.set', state: 'error' });
    }
  }

  /**
   * Modo de atención solo para el timbre físico. Si el modo es "suena primero"
   * pero no hay ninguna pestaña de la app abierta, no tiene sentido esperar:
   * atiende la IA de inmediato.
   */
  private async resolveAttention(reason: DeviceSessionReason) {
    if (reason !== 'button') {
      return undefined;
    }
    const settings = await this.attention.get();
    return {
      ringFirst: settings.mode === 'ring_first' && this.consultService.hasViewers(),
      ringMs: settings.ringSeconds * 1000,
      ownerAvailable: settings.mode !== 'ai_only',
    };
  }

  private extractToken(req: IncomingMessage): string | null {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      return url.searchParams.get('token');
    } catch {
      return null;
    }
  }

  private send(client: WebSocket, message: ServerToDeviceMessage): void {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}
