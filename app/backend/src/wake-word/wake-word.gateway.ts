import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type WebSocket from 'ws';
import type { IncomingMessage } from 'http';
import { WakeWordBridgeService } from './wake-word-bridge.service';

let connectionCounter = 0;

/**
 * Gateway WebSocket que recibe audio del navegador y lo relaya al servicio de
 * detección de palabra de activación.
 *
 * Cada cliente obtiene un puente propio hacia Python (relación 1:1) y los
 * eventos de detección se devuelven por el mismo socket.
 */
@WebSocketGateway({ path: '/wake-word' })
export class WakeWordGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(WakeWordGateway.name);
  private readonly clientIds = new Map<WebSocket, string>();

  constructor(
    private readonly bridgeService: WakeWordBridgeService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Valida el token opcional, registra el cliente y abre su puente a Python.
   *
   * @param client Socket del navegador.
   * @param req Petición de upgrade, usada para leer el token de la query.
   */
  handleConnection(client: WebSocket, req: IncomingMessage): void {
    // El token solo se exige cuando está configurado, para no romper el flujo
    // de desarrollo local contra localhost.
    const token = this.configService.get<string>('wakeword.wsToken');
    if (token) {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const provided = url.searchParams.get('token');
      if (provided !== token) {
        this.logger.warn('Rejected connection: invalid token');
        client.close(4401, 'Unauthorized');
        return;
      }
    }

    const clientId = `ww-${++connectionCounter}`;
    this.clientIds.set(client, clientId);
    this.logger.log(`Client connected: ${clientId}`);

    this.bridgeService.connect(clientId, {
      onDetection: (event) => {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify(event));
        }
      },
      onClose: () => {
        if (client.readyState === client.OPEN) {
          client.send(
            JSON.stringify({ event: 'service.unavailable' }),
          );
        }
      },
      onError: () => {
        if (client.readyState === client.OPEN) {
          client.send(
            JSON.stringify({ event: 'service.unavailable' }),
          );
        }
      },
    });

    client.on('message', (data: Buffer) => {
      this.bridgeService.sendAudio(clientId, data);
    });
  }

  /**
   * Cierra el puente asociado cuando el navegador se desconecta.
   *
   * @param client Socket del navegador.
   */
  handleDisconnect(client: WebSocket): void {
    const clientId = this.clientIds.get(client);
    if (clientId) {
      this.bridgeService.disconnect(clientId);
      this.clientIds.delete(client);
      this.logger.log(`Client disconnected: ${clientId}`);
    }
  }
}
