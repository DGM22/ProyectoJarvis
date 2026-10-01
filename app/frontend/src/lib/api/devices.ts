export type DeviceDto = {
  id: number;
  name: string;
  tokenPrefix: string;
  firmwareVersion: string | null;
  status: 'offline' | 'idle' | 'in_call';
  online: boolean;
  cameraOnline: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeviceCreatedDto = DeviceDto & { token: string };

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (typeof body.message === 'string') {
        message = body.message;
      } else if (Array.isArray(body.message)) {
        message = body.message.join(', ');
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function listDevices(): Promise<DeviceDto[]> {
  const response = await fetch(`${API_BASE_URL}/devices`);
  return parseJson(response);
}

export async function createDevice(name: string): Promise<DeviceCreatedDto> {
  const response = await fetch(`${API_BASE_URL}/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseJson(response);
}

export async function rotateDeviceToken(
  id: number,
): Promise<DeviceCreatedDto> {
  const response = await fetch(`${API_BASE_URL}/devices/${id}/rotate-token`, {
    method: 'POST',
  });
  return parseJson(response);
}

export async function callDevice(
  id: number,
  prompt?: string,
): Promise<{ ok: boolean; deviceId: number; message: string }> {
  const response = await fetch(`${API_BASE_URL}/devices/${id}/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  return parseJson(response);
}

export async function deleteDevice(id: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/devices/${id}`, {
    method: 'DELETE',
  });
  await parseJson(response);
}
