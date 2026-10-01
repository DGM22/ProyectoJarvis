import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type WebSocket from 'ws';
import { TranscriptIngestService } from './transcript-ingest.service';
import { TranscriptEventsService } from './transcript-events.service';
import type { TranscriptSegmentEvent } from '../queue/queue.constants';

let connectionCounter = 0;

interface ControlMessage {
  type: 'start' | 'stop';
  title?: string;
}

/**
 * Gateway WebSocket agnóstico a la fuente de audio.
 *
 * Hoy el frontend envía PCM del micrófono; mañana un bot de Zoom/Meet puede
 * abrir el mismo path y alimentar `TranscriptIngestService` sin cambiar el
 * resto del pipeline (cola → OpenAI → Postgres → .txt).
 */
@WebSocketGateway({ path: '/transcripts' })
export class TranscriptsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TranscriptsGateway.name);
  private readonly clientIds = new Map<WebSocket, string>();
  private readonly clientTranscriptIds = new Map<WebSocket, number>();
  private readonly unsubscribers = new Map<WebSocket, () => void>();

  constructor(
    private readonly ingestService: TranscriptIngestService,
    private readonly events: TranscriptEventsService,
  ) {}

  handleConnection(client: WebSocket): void {
    const clientId = `tr-${++connectionCounter}`;
    this.clientIds.set(client, clientId);
    this.logger.log(`Client connected: ${clientId}`);

    const unsubscribe = this.events.onSegment((event) => {
      this.forwardSegment(client, event);
    });
    this.unsubscribers.set(client, unsubscribe);

    client.on('message', (data, isBinary) => {
      void this.handleMessage(client, clientId, data, isBinary);
    });
  }

  handleDisconnect(client: WebSocket): void {
    const clientId = this.clientIds.get(client);
    this.unsubscribers.get(client)?.();
    this.unsubscribers.delete(client);
    this.clientIds.delete(client);
    this.clientTranscriptIds.delete(client);

    if (clientId && this.ingestService.hasSession(clientId)) {
      void this.ingestService.stopSession(clientId).then((result) => {
        if (result && client.readyState === client.OPEN) {
          client.send(
            JSON.stringify({
              event: 'session.stopped',
              transcriptId: result.transcriptId,
              durationSeconds: result.durationSeconds,
            }),
          );
        }
      });
    }

    this.logger.log(`Client disconnected: ${clientId ?? 'unknown'}`);
  }

  private async handleMessage(
    client: WebSocket,
    clientId: string,
    data: WebSocket.RawData,
    isBinary: boolean,
  ): Promise<void> {
    if (isBinary) {
      const frame = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer);
      await this.ingestService.appendAudio(clientId, frame);
      return;
    }

    let payload: ControlMessage;
    try {
      payload = JSON.parse(data.toString()) as ControlMessage;
    } catch {
      this.send(client, {
        event: 'session.error',
        message: 'Invalid control message',
      });
      return;
    }

    if (payload.type === 'start') {
      try {
        const session = await this.ingestService.startSession(
          clientId,
          payload.title,
        );
        this.clientTranscriptIds.set(client, session.transcriptId);
        this.send(client, {
          event: 'session.started',
          transcriptId: session.transcriptId,
          title: session.title,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to start session';
        this.send(client, { event: 'session.error', message });
      }
      return;
    }

    if (payload.type === 'stop') {
      const result = await this.ingestService.stopSession(clientId);
      if (result) {
        this.clientTranscriptIds.set(client, result.transcriptId);
        this.send(client, {
          event: 'session.stopped',
          transcriptId: result.transcriptId,
          durationSeconds: result.durationSeconds,
        });
      }
    }
  }

  private forwardSegment(
    client: WebSocket,
    event: TranscriptSegmentEvent,
  ): void {
    const boundId = this.clientTranscriptIds.get(client);
    if (boundId !== event.transcriptId) {
      return;
    }

    this.send(client, {
      event: 'transcript.segment',
      transcriptId: event.transcriptId,
      segmentId: event.segmentId,
      sequenceNumber: event.sequenceNumber,
      text: event.text,
      language: event.language,
      status: event.status,
    });
  }

  private send(client: WebSocket, payload: Record<string, unknown>): void {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(payload));
    }
  }
}
