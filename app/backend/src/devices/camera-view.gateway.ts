import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import { AuthService } from '../auth/auth.service';
import { CameraHubService } from './camera-hub.service';

/**
 * WebSocket `/camera-view` para el frontend: JSON de presencia + JPEG binario.
 */
@WebSocketGateway({ path: '/camera-view', cors: true })
export class CameraViewGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(CameraViewGateway.name);

  constructor(
    private readonly cameraHub: CameraHubService,
    private readonly authService: AuthService,
  ) {}

  async handleConnection(client: WebSocket, req: IncomingMessage): Promise<void> {
    // La cámara de la puerta solo la ve alguien con sesión.
    if (!(await this.authService.userFromRequest(req))) {
      client.close(4401, 'Unauthorized');
      return;
    }
    this.logger.log('Camera viewer connected');
    this.cameraHub.addViewer(client);
  }

  handleDisconnect(client: WebSocket): void {
    this.cameraHub.removeViewer(client);
    this.logger.log('Camera viewer disconnected');
  }
}
