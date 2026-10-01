import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type WebSocket from 'ws';
import { ConsultService } from './consult.service';

/**
 * WebSocket `/consult` para el navegador: anillo del timbre, estado de la
 * consulta y acciones Contestar / Rechazar / Terminar.
 */
@WebSocketGateway({ path: '/consult', cors: true })
export class ConsultGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ConsultGateway.name);

  constructor(private readonly consultService: ConsultService) {}

  handleConnection(client: WebSocket): void {
    this.consultService.addViewer(client);
    client.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        return;
      }
      this.consultService.handleViewerMessage(client, data.toString());
    });
    this.logger.debug('Consult viewer connected');
  }

  handleDisconnect(client: WebSocket): void {
    this.consultService.removeViewer(client);
  }
}
