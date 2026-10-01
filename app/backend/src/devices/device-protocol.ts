/**
 * Protocolo de control JSON entre NestJS y el ESP32 (canal texto del WS).
 * El audio PCM16LE 16 kHz mono viaja como frames binarios en el mismo socket.
 */

export type DeviceDisplayState =
  'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

/** Qué disparó la sesión: wake word, botón físico (timbre) o llamada desde la app. */
export type DeviceSessionReason = 'wake' | 'button' | 'inbound';

export type DeviceToServerMessage =
  | {
      type: 'hello';
      firmwareVersion?: string;
      capabilities?: string[];
    }
  | {
      type: 'session.request';
      reason: DeviceSessionReason;
      voice?: string;
    }
  | {
      type: 'session.end';
      reason?: string;
    }
  | {
      /** Stub reservado para sensores futuros; el backend lo acepta sin persistir. */
      type: 'telemetry';
      sensor: string;
      value: number;
      unit?: string;
      ts?: number;
    };

export type ServerToDeviceMessage =
  | {
      type: 'hello.ack';
      deviceId: number;
      name: string;
      serverTime: string;
    }
  | {
      type: 'session.ready';
      reason: DeviceSessionReason;
    }
  | {
      type: 'session.end';
      reason: string;
    }
  | {
      type: 'display.set';
      state: DeviceDisplayState;
    }
  | {
      type: 'inbound.start';
      prompt: string;
      voice?: string;
    }
  | {
      type: 'error';
      message: string;
    };

export function parseDeviceMessage(raw: string): DeviceToServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
    return null;
  }
  const type = (parsed as { type: unknown }).type;
  if (
    type === 'hello' ||
    type === 'session.request' ||
    type === 'session.end' ||
    type === 'telemetry'
  ) {
    return parsed as DeviceToServerMessage;
  }
  return null;
}
