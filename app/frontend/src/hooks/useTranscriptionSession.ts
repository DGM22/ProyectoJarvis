import { useCallback, useEffect, useRef, useState } from 'react';

export type TranscriptionStatus =
  | 'idle'
  | 'connecting'
  | 'recording'
  | 'stopping'
  | 'error'
  | 'permission-denied';

export interface LiveSegment {
  sequenceNumber: number;
  text: string;
  language: string | null;
  status: 'completed' | 'failed';
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

const WORKLET_URL = '/wake-word-processor.js';

function deriveWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, 'ws');
}

function buildLiveText(segments: Map<number, LiveSegment>): string {
  return [...segments.values()]
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .map((s) => s.text.trim())
    .filter((t) => t.length > 0)
    .join('\n\n');
}

/**
 * Captura el micrófono, envía PCM 16 kHz al gateway `/transcripts` y recibe
 * segmentos transcritos en vivo (ordenados por `sequenceNumber`).
 */
export function useTranscriptionSession() {
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [liveText, setLiveText] = useState('');
  const [transcriptId, setTranscriptId] = useState<number | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const segmentsRef = useRef(new Map<number, LiveSegment>());
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);

  const cleanupMedia = useCallback(() => {
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

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hardCleanup = useCallback(() => {
    generationRef.current += 1;
    clearTimer();
    cleanupMedia();

    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
  }, [cleanupMedia, clearTimer]);

  const start = useCallback(
    async (sessionTitle?: string) => {
      hardCleanup();
      const generation = generationRef.current;
      const isStale = () => generation !== generationRef.current;

      setStatus('connecting');
      setError(null);
      setLiveText('');
      setTranscriptId(null);
      setTitle(null);
      setElapsedSeconds(0);
      segmentsRef.current = new Map();
      startedAtRef.current = null;

      let stream: MediaStream | null = null;
      let audioCtx: AudioContext | null = null;

      const abortLocal = () => {
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
        abortLocal();
        return;
      }

      audioCtx = new AudioContext();

      try {
        await audioCtx.audioWorklet.addModule(WORKLET_URL);
      } catch {
        abortLocal();
        if (!isStale()) {
          setStatus('error');
          setError('No se pudo cargar el procesador de audio');
        }
        return;
      }

      if (isStale()) {
        abortLocal();
        return;
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, 'wake-word-processor');
      source.connect(worklet);

      const ws = new WebSocket(`${deriveWsUrl(API_BASE_URL)}/transcripts`);
      ws.binaryType = 'arraybuffer';

      streamRef.current = stream;
      audioCtxRef.current = audioCtx;
      workletRef.current = worklet;
      wsRef.current = ws;

      ws.onopen = () => {
        if (isStale()) {
          return;
        }
        ws.send(
          JSON.stringify({
            type: 'start',
            title: sessionTitle?.trim() || undefined,
          }),
        );
      };

      ws.onmessage = (event) => {
        if (isStale() || typeof event.data !== 'string') {
          return;
        }

        let payload: {
          event?: string;
          transcriptId?: number;
          title?: string;
          sequenceNumber?: number;
          text?: string;
          language?: string | null;
          status?: 'completed' | 'failed';
          durationSeconds?: number;
          message?: string;
        };
        try {
          payload = JSON.parse(event.data) as typeof payload;
        } catch {
          return;
        }

        if (payload.event === 'session.started' && payload.transcriptId) {
          setTranscriptId(payload.transcriptId);
          setTitle(payload.title ?? null);
          setStatus('recording');
          startedAtRef.current = Date.now();
          clearTimer();
          timerRef.current = setInterval(() => {
            if (startedAtRef.current) {
              setElapsedSeconds(
                Math.floor((Date.now() - startedAtRef.current) / 1000),
              );
            }
          }, 1000);
          return;
        }

        if (payload.event === 'transcript.segment') {
          if (
            typeof payload.sequenceNumber !== 'number' ||
            typeof payload.text !== 'string'
          ) {
            return;
          }
          segmentsRef.current.set(payload.sequenceNumber, {
            sequenceNumber: payload.sequenceNumber,
            text: payload.text,
            language: payload.language ?? null,
            status: payload.status ?? 'completed',
          });
          setLiveText(buildLiveText(segmentsRef.current));
          return;
        }

        if (payload.event === 'session.stopped') {
          clearTimer();
          cleanupMedia();
          if (typeof payload.durationSeconds === 'number') {
            setElapsedSeconds(payload.durationSeconds);
          }
          setStatus('idle');
          return;
        }

        if (payload.event === 'session.error') {
          setError(payload.message ?? 'Error de sesión');
          setStatus('error');
          hardCleanup();
        }
      };

      ws.onerror = () => {
        if (!isStale()) {
          setStatus('error');
          setError('Error de conexión WebSocket');
        }
      };

      ws.onclose = () => {
        if (isStale()) {
          return;
        }
        clearTimer();
        cleanupMedia();
        setStatus((prev) =>
          prev === 'recording' || prev === 'stopping' || prev === 'connecting'
            ? 'idle'
            : prev,
        );
      };

      worklet.port.onmessage = (msg: MessageEvent<ArrayBuffer>) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(msg.data);
        }
      };
    },
    [hardCleanup, clearTimer, cleanupMedia],
  );

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      hardCleanup();
      setStatus('idle');
      return;
    }

    setStatus('stopping');
    clearTimer();
    cleanupMedia();
    ws.send(JSON.stringify({ type: 'stop' }));
  }, [hardCleanup, clearTimer, cleanupMedia]);

  useEffect(() => {
    return () => {
      hardCleanup();
    };
  }, [hardCleanup]);

  return {
    status,
    elapsedSeconds,
    liveText,
    transcriptId,
    title,
    error,
    start,
    stop,
  };
}
