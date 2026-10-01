import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SessionTurn,
  StartVoiceChatOptions,
  UseRealtimeVoiceChatResult,
  VoiceCallMode,
  VoiceChatStatus,
} from '../types/realtime';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

const ACTIVE_STATUSES: VoiceChatStatus[] = [
  'requesting_token',
  'connecting',
  'connected',
  'listening',
  'speaking',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ventana en la que se acumulan fragmentos de transcripción, para tolerar que
 *  el VAD parta "terminar llamada Jarvis" en varios items. */
const TRANSCRIPT_WINDOW_MS = 10000;

const END_CALL_PATTERNS: RegExp[] = [
  /\b(termina|terminar|termine|finaliza|finalizar|corta|cortar|cierra|cerrar)\s+(la\s+)?(llamada|conversacion)\b/,
  /\b(cuelga|cuelgale|colgar|cuelgue)\b/,
  /\b(adios|hasta luego|nos vemos)\s+jarvis\b/,
];

/** Evita colgar cuando el usuario dice justo lo contrario ("no cuelgues"). */
const NEGATED_PATTERN =
  /\bno\s+(me\s+)?(cuelgues|cuelgue|corte|cortes|termines|termine|cierres|cierre|finalices)\b/;

function normalizeTranscript(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEndCallCommand(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript);

  if (!normalized || NEGATED_PATTERN.test(normalized)) {
    return false;
  }

  return END_CALL_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Reconoce el evento de transcripción de entrada sin depender del prefijo
 *  exacto, que ha cambiado entre versiones de la API Realtime. */
function transcriptionEventKind(type: string): 'delta' | 'completed' | null {
  if (!type.includes('input_audio_transcription')) {
    return null;
  }
  if (type.endsWith('.completed') || type.endsWith('.done')) {
    return 'completed';
  }
  if (type.endsWith('.delta')) {
    return 'delta';
  }
  return null;
}

function assistantTranscriptKind(
  type: string,
): 'delta' | 'completed' | null {
  const isAudioTranscript =
    type.includes('output_audio_transcript') ||
    type.includes('audio_transcript') ||
    type.includes('output_text') ||
    type === 'response.text.delta' ||
    type === 'response.text.done';

  if (!isAudioTranscript) return null;
  if (type.endsWith('.delta')) return 'delta';
  if (
    type.endsWith('.done') ||
    type.endsWith('.completed') ||
    type === 'response.text.done'
  ) {
    return 'completed';
  }
  return null;
}

export function useRealtimeVoiceChat(): UseRealtimeVoiceChatResult {
  const [status, setStatus] = useState<VoiceChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [callMode, setCallMode] = useState<VoiceCallMode>('assistant');
  const [consultId, setConsultId] = useState<string | null>(null);

  /** Estado síncrono: permite `stop()` + `start()` en el mismo tick (contestar el timbre). */
  const activeRef = useRef(false);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const isStoppingRef = useRef(false);
  const transcriptBufferRef = useRef('');
  const lastTranscriptAtRef = useRef(0);
  const sessionStartedAtRef = useRef<number | null>(null);
  const speechStoppedAtRef = useRef<number | null>(null);
  const userPartialIdRef = useRef<string | null>(null);
  const assistantPartialIdRef = useRef<string | null>(null);

  /** Aplica mute al track local sin cortar la sesión WebRTC. */
  const applyMuteToLocalTracks = useCallback((nextMuted: boolean) => {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
  }, []);

  const setMuted = useCallback(
    (nextMuted: boolean) => {
      applyMuteToLocalTracks(nextMuted);
      setMutedState(nextMuted);
    },
    [applyMuteToLocalTracks],
  );

  const cleanup = useCallback(() => {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    peerConnectionRef.current?.getSenders().forEach((sender) => {
      sender.track?.stop();
    });
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current.remove();
      remoteAudioRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    isStoppingRef.current = true;
    activeRef.current = false;
    transcriptBufferRef.current = '';
    sessionStartedAtRef.current = null;
    speechStoppedAtRef.current = null;
    userPartialIdRef.current = null;
    assistantPartialIdRef.current = null;
    cleanup();
    setMutedState(false);
    setElapsedSeconds(0);
    setStatus('idle');
    setError(null);
  }, [cleanup]);

  /** Acumula el fragmento y decide si el usuario pidió colgar. */
  const consumeTranscript = useCallback((chunk: string): boolean => {
    const now = Date.now();
    if (now - lastTranscriptAtRef.current > TRANSCRIPT_WINDOW_MS) {
      transcriptBufferRef.current = '';
    }
    lastTranscriptAtRef.current = now;

    transcriptBufferRef.current = `${transcriptBufferRef.current} ${chunk}`
      .slice(-400)
      .trim();

    if (isEndCallCommand(transcriptBufferRef.current)) {
      transcriptBufferRef.current = '';
      return true;
    }
    return false;
  }, []);

  const appendUserPartial = useCallback((chunk: string) => {
    setTurns((prev) => {
      const id = userPartialIdRef.current;
      if (id) {
        return prev.map((turn) =>
          turn.id === id && turn.role === 'user'
            ? { ...turn, text: `${turn.text}${chunk}`, partial: true }
            : turn,
        );
      }
      const nextId = newId('user');
      userPartialIdRef.current = nextId;
      return [...prev, { id: nextId, role: 'user', text: chunk, partial: true }];
    });
  }, []);

  const finalizeUserTranscript = useCallback((transcript: string) => {
    const text = transcript.trim();
    if (!text) {
      userPartialIdRef.current = null;
      return;
    }

    setTurns((prev) => {
      const id = userPartialIdRef.current;
      if (id) {
        return prev.map((turn) =>
          turn.id === id && turn.role === 'user'
            ? { id, role: 'user', text, partial: false }
            : turn,
        );
      }
      return [...prev, { id: newId('user'), role: 'user', text }];
    });
    userPartialIdRef.current = null;
  }, []);

  const appendAssistantPartial = useCallback((chunk: string) => {
    setTurns((prev) => {
      const id = assistantPartialIdRef.current;
      if (id) {
        return prev.map((turn) =>
          turn.id === id && turn.role === 'assistant'
            ? { ...turn, text: `${turn.text}${chunk}` }
            : turn,
        );
      }
      const nextId = newId('assistant');
      assistantPartialIdRef.current = nextId;
      return [...prev, { id: nextId, role: 'assistant', text: chunk }];
    });
  }, []);

  const finalizeAssistantTranscript = useCallback((transcript?: string) => {
    if (typeof transcript === 'string' && transcript.trim()) {
      const text = transcript.trim();
      setTurns((prev) => {
        const id = assistantPartialIdRef.current;
        if (id) {
          return prev.map((turn) =>
            turn.id === id && turn.role === 'assistant'
              ? { id, role: 'assistant', text }
              : turn,
          );
        }
        return [...prev, { id: newId('assistant'), role: 'assistant', text }];
      });
    }
    assistantPartialIdRef.current = null;
  }, []);

  const markResponseLatency = useCallback(() => {
    if (speechStoppedAtRef.current == null) return;
    const ms = Date.now() - speechStoppedAtRef.current;
    speechStoppedAtRef.current = null;
    if (ms >= 0 && ms < 60_000) {
      setLatencyMs(ms);
    }
  }, []);

  const handleDataChannelMessage = useCallback(
    (event: MessageEvent<string>) => {
      try {
        const payload: unknown = JSON.parse(event.data);
        if (!isRecord(payload) || typeof payload.type !== 'string') {
          return;
        }

        const transcriptionKind = transcriptionEventKind(payload.type);
        if (transcriptionKind) {
          const chunk =
            transcriptionKind === 'completed'
              ? payload.transcript
              : (payload.delta ?? payload.transcript);

          if (typeof chunk === 'string' && chunk.length > 0) {
            if (transcriptionKind === 'delta') {
              appendUserPartial(chunk);
            } else {
              finalizeUserTranscript(chunk);
            }

            if (consumeTranscript(chunk)) {
              stop();
            }
          }
          return;
        }

        const assistantKind = assistantTranscriptKind(payload.type);
        if (assistantKind) {
          const chunk =
            assistantKind === 'completed'
              ? (payload.transcript ?? payload.text)
              : (payload.delta ?? payload.transcript ?? payload.text);

          if (assistantKind === 'delta' && typeof chunk === 'string') {
            markResponseLatency();
            appendAssistantPartial(chunk);
          } else if (assistantKind === 'completed') {
            finalizeAssistantTranscript(
              typeof chunk === 'string' ? chunk : undefined,
            );
          }
          return;
        }

        switch (payload.type) {
          case 'input_audio_buffer.speech_started':
            setStatus('listening');
            break;
          case 'input_audio_buffer.speech_stopped':
            speechStoppedAtRef.current = Date.now();
            setStatus('connected');
            break;
          case 'output_audio_buffer.started':
          case 'response.output_audio.delta':
          case 'response.audio.delta':
            markResponseLatency();
            setStatus('speaking');
            break;
          case 'output_audio_buffer.stopped':
          case 'response.done':
            finalizeAssistantTranscript();
            setStatus('connected');
            break;
          case 'error': {
            const message =
              isRecord(payload.error) &&
              typeof payload.error.message === 'string'
                ? payload.error.message
                : 'Realtime session error';
            setError(message);
            setStatus('error');
            break;
          }
          default:
            break;
        }
      } catch {
        // Ignore malformed data-channel frames
      }
    },
    [
      appendAssistantPartial,
      appendUserPartial,
      consumeTranscript,
      finalizeAssistantTranscript,
      finalizeUserTranscript,
      markResponseLatency,
      stop,
    ],
  );

  const sendText = useCallback((raw: string): boolean => {
    const text = raw.trim();
    const channel = dataChannelRef.current;
    if (!text || !channel || channel.readyState !== 'open') {
      return false;
    }

    setTurns((prev) => [
      ...prev,
      { id: newId('user'), role: 'user', text },
    ]);

    speechStoppedAtRef.current = Date.now();

    channel.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      }),
    );
    channel.send(JSON.stringify({ type: 'response.create' }));
    return true;
  }, []);

  const start = useCallback(
    async (options: StartVoiceChatOptions) => {
      if (activeRef.current) {
        return;
      }
      activeRef.current = true;

      const mode = options.mode ?? 'assistant';
      setCallMode(mode);
      setConsultId(options.consultId ?? null);

      isStoppingRef.current = false;
      transcriptBufferRef.current = '';
      userPartialIdRef.current = null;
      assistantPartialIdRef.current = null;
      speechStoppedAtRef.current = null;
      setMutedState(false);
      setTurns([]);
      setLatencyMs(null);
      setElapsedSeconds(0);
      setError(null);
      cleanup();

      try {
        setStatus('connecting');

        const peerConnection = new RTCPeerConnection();
        peerConnectionRef.current = peerConnection;

        const remoteAudio = document.createElement('audio');
        remoteAudio.autoplay = true;
        remoteAudioRef.current = remoteAudio;

        peerConnection.ontrack = (event) => {
          const [remoteStream] = event.streams;
          if (remoteStream && remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream;
            void remoteAudioRef.current.play().catch(() => {
              // Autoplay may require a user gesture; start() is already user-initiated.
            });
          }
        };

        peerConnection.onconnectionstatechange = () => {
          const state = peerConnection.connectionState;
          if (state === 'failed' || state === 'disconnected') {
            activeRef.current = false;
            setError(`WebRTC connection ${state}`);
            setStatus('error');
            cleanup();
          } else if (state === 'closed' && !isStoppingRef.current) {
            activeRef.current = false;
            setStatus('ended');
          }
        };

        const dataChannel = peerConnection.createDataChannel('oai-events');
        dataChannelRef.current = dataChannel;
        dataChannel.addEventListener('message', handleDataChannelMessage);

        // Pedir la primera respuesta en cuanto el canal esté listo para que Jarvis
        // salude sin esperar a que el usuario hable. El texto del saludo vive en
        // las instrucciones de sesión del backend.
        dataChannel.addEventListener('open', () => {
          dataChannel.send(JSON.stringify({ type: 'response.create' }));
        });

        const localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        localStreamRef.current = localStream;
        localStream.getTracks().forEach((track) => {
          peerConnection.addTrack(track, localStream);
        });

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        const query = new URLSearchParams({ voice: options.voice, mode });
        if (options.consultId) {
          query.set('consultId', options.consultId);
        }

        const sdpResponse = await fetch(
          `${API_BASE_URL}/realtime/calls?${query.toString()}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/sdp',
            },
            body: offer.sdp ?? '',
          },
        );

        if (!sdpResponse.ok) {
          const body = await sdpResponse.text();
          throw new Error(
            body || `Realtime call failed (${sdpResponse.status})`,
          );
        }

        const answerSdp = await sdpResponse.text();
        await peerConnection.setRemoteDescription({
          type: 'answer',
          sdp: answerSdp,
        });

        if (isStoppingRef.current) {
          cleanup();
          return;
        }

        sessionStartedAtRef.current = Date.now();
        setStatus('connected');
      } catch (err) {
        activeRef.current = false;
        cleanup();
        sessionStartedAtRef.current = null;
        const message =
          err instanceof Error ? err.message : 'Unable to start voice chat';
        setError(message);
        setStatus('error');
      }
    },
    [cleanup, handleDataChannelMessage],
  );

  useEffect(() => {
    if (!ACTIVE_STATUSES.includes(status) || !sessionStartedAtRef.current) {
      return undefined;
    }

    const tick = () => {
      const started = sessionStartedAtRef.current;
      if (started) {
        setElapsedSeconds(Math.floor((Date.now() - started) / 1000));
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [status]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    status,
    error,
    isActive: ACTIVE_STATUSES.includes(status),
    muted,
    setMuted,
    turns,
    sendText,
    latencyMs,
    elapsedSeconds,
    callMode,
    consultId,
    start,
    stop,
  };
}
