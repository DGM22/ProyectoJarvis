import { useCallback, useEffect, useRef, useState } from 'react';

export type WakeWordStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'error'
  | 'permission-denied';

interface UseWakeWordOptions {
  enabled: boolean;
  paused: boolean;
  onWakeWord: () => void;
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

const WORKLET_URL = '/wake-word-processor.js';
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
const UNAUTHORIZED_CLOSE_CODE = 4401;

function deriveWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, 'ws');
}

export function useWakeWord({
  enabled,
  paused,
  onWakeWord,
}: UseWakeWordOptions): { status: WakeWordStatus } {
  const [status, setStatus] = useState<WakeWordStatus>('idle');

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_BASE_MS);

  // Cada arranque toma un número de generación. `cleanup` lo incrementa, así que
  // un arranque que quedó esperando un `await` detecta que ya está obsoleto y
  // aborta en vez de sobrescribir los refs con un socket huérfano.
  const generationRef = useRef(0);

  const onWakeWordRef = useRef(onWakeWord);
  onWakeWordRef.current = onWakeWord;

  const cleanup = useCallback(() => {
    generationRef.current += 1;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    if (workletRef.current) {
      workletRef.current.port.onmessage = null;
      workletRef.current.disconnect();
      workletRef.current = null;
    }

    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startPipeline = useCallback(async () => {
    cleanup();

    const generation = generationRef.current;
    const isStale = () => generation !== generationRef.current;

    setStatus('connecting');

    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;

    // Libera lo que se haya creado localmente cuando el arranque se descarta.
    const abort = () => {
      stream?.getTracks().forEach((track) => track.stop());
      if (audioCtx) {
        void audioCtx.close();
      }
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      if (!isStale()) {
        setStatus('permission-denied');
      }
      return;
    }

    if (isStale()) {
      abort();
      return;
    }

    audioCtx = new AudioContext();

    try {
      await audioCtx.audioWorklet.addModule(WORKLET_URL);
    } catch {
      abort();
      if (!isStale()) {
        setStatus('error');
      }
      return;
    }

    if (isStale()) {
      abort();
      return;
    }

    const source = audioCtx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioCtx, 'wake-word-processor');
    source.connect(worklet);

    const ws = new WebSocket(`${deriveWsUrl(API_BASE_URL)}/wake-word`);
    ws.binaryType = 'arraybuffer';

    streamRef.current = stream;
    audioCtxRef.current = audioCtx;
    workletRef.current = worklet;
    wsRef.current = ws;

    const scheduleReconnect = () => {
      if (isStale()) {
        return;
      }

      setStatus('connecting');
      const delay = Math.min(reconnectDelayRef.current, RECONNECT_MAX_MS);
      reconnectDelayRef.current = delay * 1.5;
      reconnectTimerRef.current = setTimeout(() => {
        void startPipeline();
      }, delay);
    };

    ws.onopen = () => {
      if (isStale()) {
        return;
      }
      setStatus('listening');
      reconnectDelayRef.current = RECONNECT_BASE_MS;
    };

    ws.onmessage = (event) => {
      if (isStale() || typeof event.data !== 'string') {
        return;
      }

      let payload: { event?: string };
      try {
        payload = JSON.parse(event.data) as { event?: string };
      } catch {
        return;
      }

      if (payload.event === 'wake_word.detected') {
        // Liberar el micrófono antes de que el caller abra la sesión Realtime,
        // para que ambos flujos no compitan por `getUserMedia`.
        cleanup();
        setStatus('idle');
        onWakeWordRef.current();
      }
    };

    ws.onclose = (event) => {
      if (event.code === UNAUTHORIZED_CLOSE_CODE) {
        if (!isStale()) {
          setStatus('error');
        }
        return;
      }
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };

    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(event.data);
      }
    };
  }, [cleanup]);

  const active = enabled && !paused;

  useEffect(() => {
    if (!active) {
      cleanup();
      setStatus('idle');
      return undefined;
    }

    void startPipeline();

    return cleanup;
  }, [active, startPipeline, cleanup]);

  return { status };
}
