import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { TranscriptSegmentEvent } from '../queue/queue.constants';
import { TRANSCRIPT_SEGMENT_EVENT } from '../queue/queue.constants';

/**
 * Bus de eventos in-process entre el worker BullMQ y el gateway WebSocket.
 *
 * Suficiente mientras Nest corre en un solo proceso; si se escala a varios
 * workers, se puede sustituir por Redis pub/sub sin tocar el gateway.
 */
@Injectable()
export class TranscriptEventsService {
  private readonly emitter = new EventEmitter();

  emitSegment(event: TranscriptSegmentEvent): void {
    this.emitter.emit(TRANSCRIPT_SEGMENT_EVENT, event);
  }

  onSegment(handler: (event: TranscriptSegmentEvent) => void): () => void {
    this.emitter.on(TRANSCRIPT_SEGMENT_EVENT, handler);
    return () => {
      this.emitter.off(TRANSCRIPT_SEGMENT_EVENT, handler);
    };
  }
}
