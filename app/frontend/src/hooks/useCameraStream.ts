import { useEffect, useRef, useState } from 'react';
import { deriveWsUrl } from '@/lib/wsUrl';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export type CameraStreamStatus =
  | 'idle'
  | 'connecting'
  | 'online'
  | 'offline'
  | 'error';

export function useCameraStream(enabled: boolean) {
  const [status, setStatus] = useState<CameraStreamStatus>('idle');
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [cameraName, setCameraName] = useState<string | null>(null);
  const frameUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }

    let closed = false;
    setStatus('connecting');

    const ws = new WebSocket(`${deriveWsUrl(API_BASE_URL)}/camera-view`);
    ws.binaryType = 'arraybuffer';

    ws.addEventListener('open', () => {
      if (!closed) {
        setStatus('connecting');
      }
    });

    ws.addEventListener('message', (event: MessageEvent<string | ArrayBuffer>) => {
      if (closed) {
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        const blob = new Blob([event.data], { type: 'image/jpeg' });
        const next = URL.createObjectURL(blob);
        const prev = frameUrlRef.current;
        frameUrlRef.current = next;
        setFrameUrl(next);
        setStatus('online');
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return;
      }
      if (typeof event.data !== 'string') {
        return;
      }
      try {
        const parsed = JSON.parse(event.data) as {
          type?: string;
          name?: string;
        };
        if (parsed.type === 'camera.online') {
          setCameraName(parsed.name ?? 'Cámara');
          setStatus('online');
        } else if (parsed.type === 'camera.offline') {
          setStatus('offline');
        } else if (parsed.type === 'stream.idle') {
          setStatus('offline');
        }
      } catch {
        // ignore
      }
    });

    ws.addEventListener('error', () => {
      if (!closed) {
        setStatus('error');
      }
    });

    ws.addEventListener('close', () => {
      if (!closed) {
        setStatus('offline');
      }
    });

    return () => {
      closed = true;
      ws.close();
      if (frameUrlRef.current) {
        URL.revokeObjectURL(frameUrlRef.current);
        frameUrlRef.current = null;
      }
      setFrameUrl(null);
    };
  }, [enabled]);

  return { status, frameUrl, cameraName };
}
