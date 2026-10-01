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

/** Un frame más viejo que esto ya no representa la puerta "en vivo". */
const LAST_FRAME_MAX_AGE_MS = 2000;

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
    if (this.viewers.size > 0) {
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
    if (becameFirst) {
      this.setStreaming(true);
    }
  }

  removeViewer(socket: WebSocket): void {
    const had = this.viewers.delete(socket);
    if (had && this.viewers.size === 0) {
      this.setStreaming(false);
    }
  }

  forwardJpeg(fromDeviceId: number, jpeg: Buffer): void {
    const entry = this.cameras.get(fromDeviceId);
    if (entry) {
      entry.lastFrame = { jpeg, at: Date.now() };
    }
    for (const viewer of this.viewers) {
      if (viewer.readyState === viewer.OPEN) {
        viewer.send(jpeg, { binary: true });
      }
    }
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
