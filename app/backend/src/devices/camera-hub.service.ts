import { Injectable, Logger } from '@nestjs/common';
import type WebSocket from 'ws';

export type CameraViewerEvent =
  | { type: 'camera.online'; deviceId: number; name: string }
  | { type: 'camera.offline'; deviceId: number }
  | { type: 'stream.idle' };

type CameraEntry = {
  socket: WebSocket;
  name: string;
  lastFrame?: { jpeg: Buffer; at: number };
};

/** Foto tomada de una cámara para análisis (p. ej. verificación facial). */
export type CapturedFrame = { deviceId: number; jpeg: Buffer; at: number };

type PendingCapture = {
  /** Frames anteriores a esto son del arranque del sensor (oscuros). */
  notBefore: number;
  /** Mejor frame recibido aunque sea de calentamiento, por si vence el plazo. */
  fallback: CapturedFrame | null;
  resolve: (frame: CapturedFrame | null) => void;
};

/** Un frame más viejo que esto ya no representa la puerta "en vivo". */
const LAST_FRAME_MAX_AGE_MS = 2000;
/** Un frame así de reciente sirve como foto sin tocar el stream. */
const CAPTURE_FRESH_FRAME_MS = 500;
/** Tras `stream.on` el sensor tarda en ajustar exposición. */
const CAPTURE_WARMUP_MS = 600;
const CAPTURE_TIMEOUT_MS = 4000;
/**
 * Margen antes de mandar `stream.off` al quedarse sin viewers: al pasar de
 * "sonando" a "en llamada" la app remonta la vista y por un instante hay 0
 * viewers; sin margen la cámara se apagaba a media llamada.
 */
const STREAM_OFF_GRACE_MS = 5000;

/**
 * Relé JPEG: una o más cámaras ESP32 → N viewers del browser.
 *
 * El binario de `/camera` es JPEG, nunca PCM. `stream.on` solo se manda
 * cuando hay al menos un viewer, para no encodear 24/7.
 */
@Injectable()
export class CameraHubService {
  private readonly logger = new Logger(CameraHubService.name);
  private readonly cameras = new Map<number, CameraEntry>();
  private readonly viewers = new Set<WebSocket>();
  private readonly pendingCaptures = new Set<PendingCapture>();
  private streamOffTimer: NodeJS.Timeout | null = null;
  /** Capturas en curso que mantienen el stream encendido sin viewers. */
  private captureHolds = 0;

  isCameraOnline(deviceId: number): boolean {
    return this.cameras.has(deviceId);
  }

  onlineCameraIds(): number[] {
    return [...this.cameras.keys()];
  }

  registerCamera(deviceId: number, socket: WebSocket, name: string): void {
    const existing = this.cameras.get(deviceId);
    if (existing && existing.socket !== socket) {
      try {
        existing.socket.close(4000, 'replaced');
      } catch {
        // ignore
      }
    }
    this.cameras.set(deviceId, { socket, name });
    this.broadcastToViewers({ type: 'camera.online', deviceId, name });
    if (this.isStreaming()) {
      this.sendToCamera(socket, { type: 'stream.on' });
    }
    this.logger.log(`Camera online: ${deviceId} (${name})`);
  }

  unregisterCamera(deviceId: number, socket: WebSocket): void {
    const current = this.cameras.get(deviceId);
    if (!current || current.socket !== socket) {
      return;
    }
    this.cameras.delete(deviceId);
    this.broadcastToViewers({ type: 'camera.offline', deviceId });
    this.logger.log(`Camera offline: ${deviceId}`);
  }

  addViewer(socket: WebSocket): void {
    this.viewers.add(socket);
    const becameFirst = this.viewers.size === 1;
    const now = Date.now();
    for (const [deviceId, entry] of this.cameras) {
      this.sendToViewer(socket, {
        type: 'camera.online',
        deviceId,
        name: entry.name,
      });
      if (
        entry.lastFrame &&
        now - entry.lastFrame.at <= LAST_FRAME_MAX_AGE_MS &&
        socket.readyState === socket.OPEN
      ) {
        socket.send(entry.lastFrame.jpeg, { binary: true });
      }
    }
    if (this.cameras.size === 0) {
      this.sendToViewer(socket, { type: 'stream.idle' });
    }
    if (this.streamOffTimer) {
      // Volvió un viewer dentro del margen: la cámara nunca se apagó.
      clearTimeout(this.streamOffTimer);
      this.streamOffTimer = null;
    } else if (becameFirst && this.captureHolds === 0) {
      this.setStreaming(true);
    }
  }

  removeViewer(socket: WebSocket): void {
    const had = this.viewers.delete(socket);
    if (had && this.viewers.size === 0 && !this.streamOffTimer) {
      this.streamOffTimer = setTimeout(() => {
        this.streamOffTimer = null;
        if (!this.isStreaming()) {
          this.setStreaming(false);
        }
      }, STREAM_OFF_GRACE_MS);
    }
  }

  /**
   * Toma una foto de la puerta. Si nadie está viendo la cámara, la enciende
   * solo el tiempo necesario y descarta los frames de arranque del sensor.
   *
   * @returns El frame, o `null` si no hay cámara en línea o no llegó a tiempo.
   */
  async captureFrame(
    timeoutMs = CAPTURE_TIMEOUT_MS,
  ): Promise<CapturedFrame | null> {
    if (this.cameras.size === 0) {
      return null;
    }
    const now = Date.now();
    const fresh = this.freshestFrame(now - CAPTURE_FRESH_FRAME_MS);
    if (fresh) {
      return fresh;
    }

    const wasStreaming = this.isStreaming();
    this.captureHolds += 1;
    if (!wasStreaming) {
      this.setStreaming(true);
    }
    try {
      return await new Promise<CapturedFrame | null>((resolve) => {
        const pending: PendingCapture = {
          notBefore: wasStreaming ? now : now + CAPTURE_WARMUP_MS,
          fallback: null,
          resolve: (frame) => {
            clearTimeout(timer);
            this.pendingCaptures.delete(pending);
            resolve(frame);
          },
        };
        const timer = setTimeout(
          () => pending.resolve(pending.fallback),
          timeoutMs,
        );
        this.pendingCaptures.add(pending);
      });
    } finally {
      this.captureHolds -= 1;
      if (!this.isStreaming()) {
        this.setStreaming(false);
      }
    }
  }

  forwardJpeg(fromDeviceId: number, jpeg: Buffer): void {
    const entry = this.cameras.get(fromDeviceId);
    const at = Date.now();
    if (entry) {
      entry.lastFrame = { jpeg, at };
    }
    for (const pending of [...this.pendingCaptures]) {
      const frame = { deviceId: fromDeviceId, jpeg, at };
      if (at >= pending.notBefore) {
        pending.resolve(frame);
      } else {
        pending.fallback = frame;
      }
    }
    for (const viewer of this.viewers) {
      if (viewer.readyState === viewer.OPEN) {
        viewer.send(jpeg, { binary: true });
      }
    }
  }

  /** Encendido mientras haya viewers, margen de apagado o capturas en curso. */
  private isStreaming(): boolean {
    return (
      this.viewers.size > 0 ||
      this.streamOffTimer !== null ||
      this.captureHolds > 0
    );
  }

  private freshestFrame(since: number): CapturedFrame | null {
    let best: CapturedFrame | null = null;
    for (const [deviceId, entry] of this.cameras) {
      const frame = entry.lastFrame;
      if (frame && frame.at >= since && (!best || frame.at > best.at)) {
        best = { deviceId, jpeg: frame.jpeg, at: frame.at };
      }
    }
    return best;
  }

  private setStreaming(on: boolean): void {
    const message = { type: on ? 'stream.on' : 'stream.off' };
    for (const entry of this.cameras.values()) {
      this.sendToCamera(entry.socket, message);
    }
    this.logger.log(`Camera streaming ${on ? 'on' : 'off'} (${this.cameras.size} cams)`);
  }

  private sendToCamera(socket: WebSocket, message: { type: string }): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private sendToViewer(socket: WebSocket, event: CameraViewerEvent): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  }

  private broadcastToViewers(event: CameraViewerEvent): void {
    for (const viewer of this.viewers) {
      this.sendToViewer(viewer, event);
    }
  }
}
