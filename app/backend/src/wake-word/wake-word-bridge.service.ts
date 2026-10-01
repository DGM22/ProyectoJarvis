import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';

export interface BridgeCallbacks {
  onDetection: (event: { event: string; keyword: string; confidence: number }) => void;
  onClose: () => void;
  onError: (error: Error) => void;
}

/**
 * Mantiene una conexión WebSocket saliente por cliente hacia el microservicio
 * Python de openWakeWord.
 *
 * Sigue el mismo patrón que `RealtimeSidebandService`: un `Map` de conexiones
 * indexado por identificador, con cierre ordenado al destruir el módulo.
 */
@Injectable()
export class WakeWordBridgeService implements OnModuleDestroy {
  private readonly logger = new Logger(WakeWordBridgeService.name);
  private readonly bridges = new Map<string, WebSocket>();

  constructor(private readonly configService: ConfigService) {}

  /**
   * Abre el puente hacia el servicio Python para un cliente.
   *
   * @param clientId Identificador del cliente del gateway.
   * @param callbacks Handlers de detección, cierre y error.
   */
  connect(clientId: string, callbacks: BridgeCallbacks): void {
    if (this.bridges.has(clientId)) {
      return;
    }

    const serviceUrl = this.configService.get<string>('wakeword.serviceUrl');
    if (!serviceUrl) {
      callbacks.onError(new Error('WAKEWORD_SERVICE_URL is not configured'));
      return;
    }

    const wsUrl = serviceUrl.replace(/\/$/, '') + '/ws';
    const ws = new WebSocket(wsUrl);

    this.bridges.set(clientId, ws);

    ws.on('open', () => {
      this.logger.log(`Bridge connected for client ${clientId}`);
    });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as {
          event: string;
          keyword: string;
          confidence: number;
        };
        if (parsed.event === 'wake_word.detected') {
          this.logger.log(
            `Wake word detected for client ${clientId}: ${parsed.keyword} (${parsed.confidence})`,
          );
          callbacks.onDetection(parsed);
        }
      } catch {
        // Ignore malformed messages from the Python service
      }
    });

    ws.on('close', () => {
      this.bridges.delete(clientId);
      this.logger.log(`Bridge closed for client ${clientId}`);
      callbacks.onClose();
    });

    ws.on('error', (error) => {
      this.bridges.delete(clientId);
      const code = (error as NodeJS.ErrnoException).code;
      const detail = [error.message, code].filter(Boolean).join(' ') ||
        String(error);
      this.logger.error(
        `Bridge error for client ${clientId} (${wsUrl}): ${detail}`,
      );
      callbacks.onError(error);
    });
  }

  /**
   * Reenvía un fragmento de audio PCM al servicio Python.
   *
   * Los fragmentos se descartan si el puente todavía no está abierto, para no
   * acumular audio en memoria cuando el servicio no está disponible.
   *
   * @param clientId Identificador del cliente del gateway.
   * @param data Audio PCM de 16 bits a 16 kHz.
   */
  sendAudio(clientId: string, data: Buffer): void {
    const ws = this.bridges.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }

  /**
   * Cierra el puente de un cliente y lo quita del registro.
   *
   * @param clientId Identificador del cliente del gateway.
   */
  disconnect(clientId: string): void {
    const ws = this.bridges.get(clientId);
    if (ws) {
      ws.close();
      this.bridges.delete(clientId);
    }
  }

  /** Cierra todos los puentes abiertos al apagar la aplicación. */
  onModuleDestroy(): void {
    for (const [clientId, ws] of this.bridges.entries()) {
      ws.close();
      this.bridges.delete(clientId);
    }
  }
}
