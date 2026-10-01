import { Injectable } from '@nestjs/common';
import type WebSocket from 'ws';
import type { ServerToDeviceMessage } from './device-protocol';

type LiveDevice = {
  deviceId: number;
  socket: WebSocket;
  bridgeKey: string;
};

/**
 * Registro en memoria de sockets ESP32 conectados.
 *
 * Permite que el controlador HTTP (botón "Llamar") localice el WS vivo sin
 * acoplar Nest HTTP al gateway.
 */
@Injectable()
export class DevicesRegistryService {
  private readonly byDeviceId = new Map<number, LiveDevice>();
  private readonly bySocket = new Map<WebSocket, LiveDevice>();

  register(deviceId: number, socket: WebSocket, bridgeKey: string): void {
    const existing = this.byDeviceId.get(deviceId);
    if (existing && existing.socket !== socket) {
      try {
        existing.socket.close(4000, 'replaced');
      } catch {
        // ignore
      }
      this.bySocket.delete(existing.socket);
    }
    const entry: LiveDevice = { deviceId, socket, bridgeKey };
    this.byDeviceId.set(deviceId, entry);
    this.bySocket.set(socket, entry);
  }

  unregister(socket: WebSocket): LiveDevice | null {
    const entry = this.bySocket.get(socket);
    if (!entry) {
      return null;
    }
    this.bySocket.delete(socket);
    const current = this.byDeviceId.get(entry.deviceId);
    if (current?.socket === socket) {
      this.byDeviceId.delete(entry.deviceId);
    }
    return entry;
  }

  get(deviceId: number): LiveDevice | null {
    return this.byDeviceId.get(deviceId) ?? null;
  }

  isOnline(deviceId: number): boolean {
    const entry = this.byDeviceId.get(deviceId);
    return Boolean(entry && entry.socket.readyState === entry.socket.OPEN);
  }

  getBridgeKey(deviceId: number): string | null {
    return this.byDeviceId.get(deviceId)?.bridgeKey ?? null;
  }

  send(deviceId: number, message: ServerToDeviceMessage): boolean {
    const entry = this.byDeviceId.get(deviceId);
    if (!entry || entry.socket.readyState !== entry.socket.OPEN) {
      return false;
    }
    entry.socket.send(JSON.stringify(message));
    return true;
  }

  onlineDeviceIds(): number[] {
    return [...this.byDeviceId.keys()].filter((id) => this.isOnline(id));
  }
}
