import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import { AuthService } from '../auth/auth.service';
import { ConsultService } from './consult.service';

/**
 * WebSocket `/consult` para el navegador: anillo del timbre, estado de la
 * consulta y acciones Contestar / Rechazar / Terminar.
 */
@WebSocketGateway({ path: '/consult', cors: true })
export class ConsultGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ConsultGateway.name);

  constructor(
    private readonly consultService: ConsultService,
    private readonly authService: AuthService,
  ) {}

  async handleConnection(client: WebSocket, req: IncomingMessage): Promise<void> {
    // Sin sesión no se ve quién toca ni se puede contestar.
    const user = await this.authService.userFromRequest(req);
    if (!user) {
      client.close(4401, 'Unauthorized');
      return;
    }
    this.consultService.addViewer(client);
    this.consultService.setViewerPerson(client, user.personId);
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
