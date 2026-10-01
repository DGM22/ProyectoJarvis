import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type WebSocket from 'ws';
import { CameraHubService } from './camera-hub.service';

/**
 * WebSocket `/camera-view` para el frontend: JSON de presencia + JPEG binario.
 */
@WebSocketGateway({ path: '/camera-view', cors: true })
export class CameraViewGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(CameraViewGateway.name);

  constructor(private readonly cameraHub: CameraHubService) {}

  handleConnection(client: WebSocket): void {
    this.logger.log('Camera viewer connected');
    this.cameraHub.addViewer(client);
  }

  handleDisconnect(client: WebSocket): void {
    this.cameraHub.removeViewer(client);
    this.logger.log('Camera viewer disconnected');
  }
}
