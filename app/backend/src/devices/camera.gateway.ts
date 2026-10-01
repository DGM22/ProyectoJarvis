import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import { CameraHubService } from './camera-hub.service';
import { DevicesService } from './devices.service';

/**
 * WebSocket `/camera` para la Freenove (JPEG binario + JSON de control).
 *
 * No reutiliza `/devices`: el binario de ese path es PCM hacia OpenAI.
 */
@WebSocketGateway({ path: '/camera' })
export class CameraGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(CameraGateway.name);
  private readonly deviceIds = new Map<WebSocket, number>();

  constructor(
    private readonly devicesService: DevicesService,
    private readonly cameraHub: CameraHubService,
  ) {}

  async handleConnection(
    client: WebSocket,
    req: IncomingMessage,
  ): Promise<void> {
    const token = this.extractToken(req);
    const device = token ? await this.devicesService.authenticate(token) : null;
    if (!device) {
      this.logger.warn('Rejected camera connection: invalid token');
      client.close(4401, 'Unauthorized');
      return;
    }

    this.deviceIds.set(client, device.id);
    this.cameraHub.registerCamera(device.id, client, device.name);
    await this.devicesService.markStatus(device.id, 'idle', {
      firmwareVersion: 'camera',
    });
    this.send(client, {
      type: 'hello.ack',
      deviceId: device.id,
      name: device.name,
    });

    client.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      this.handleMessage(client, data, isBinary);
    });
  }

  async handleDisconnect(client: WebSocket): Promise<void> {
    const deviceId = this.deviceIds.get(client);
    if (deviceId !== undefined) {
      this.cameraHub.unregisterCamera(deviceId, client);
      this.deviceIds.delete(client);
      try {
        await this.devicesService.markStatus(deviceId, 'offline');
      } catch {
        // el dispositivo pudo borrarse
      }
    }
  }

  private handleMessage(
    client: WebSocket,
    data: WebSocket.RawData,
    isBinary: boolean,
  ): void {
    const deviceId = this.deviceIds.get(client);
    if (deviceId === undefined) {
      return;
    }

    if (isBinary) {
      const jpeg = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer);
      if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
        return;
      }
      this.cameraHub.forwardJpeg(deviceId, jpeg);
      return;
    }

    const raw =
      typeof data === 'string'
        ? data
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Buffer.from(data as ArrayBuffer).toString('utf8');

    try {
      const parsed = JSON.parse(raw) as { type?: string; firmwareVersion?: string };
      if (parsed.type === 'hello' && parsed.firmwareVersion) {
        void this.devicesService.markStatus(deviceId, 'idle', {
          firmwareVersion: parsed.firmwareVersion,
        });
      }
    } catch {
      // ignore malformed control
    }
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

  private send(client: WebSocket, message: Record<string, unknown>): void {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}
