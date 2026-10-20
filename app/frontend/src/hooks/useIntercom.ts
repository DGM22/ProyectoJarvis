import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/lib/api/http';
import { deriveWsUrl } from '@/lib/wsUrl';
import { requestMicrophone, VOICE_AUDIO_CONSTRAINTS } from '@/lib/microphone';

/** Mismo formato que la bocina del ESP32: PCM16 LE mono 16 kHz. */
const WIRE_RATE = 16000;
/** 20 ms por frame hacia el servidor (la compuerta de voz mide por frame). */
const FRAME_SAMPLES = 320;
/** Colchón antes de reproducir la voz del visitante (absorbe saltos de red). */
const PLAYBACK_PREBUFFER_MS = 120;
const LEVEL_REFRESH_MS = 100;

export type IntercomStatus = 'idle' | 'connecting' | 'on' | 'ended' | 'error';
export type IntercomReturn = 'ai' | 'close';

/**
 * AudioWorklets en línea (sin archivo extra que servir):
 * - capture: mic a cualquier tasa → 16 kHz (decimación promediada) → Int16.
 * - player: Int16 16 kHz → tasa del contexto (interpolación lineal) con
 *   colchón; si se vacía, rellena con silencio y vuelve a juntar colchón.
 */
const WORKLET_SOURCE = `
class IntercomCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${WIRE_RATE};
    this.phase = 0; this.acc = 0; this.accN = 0;
    this.frame = new Int16Array(${FRAME_SAMPLES}); this.n = 0; this.peak = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.acc += input[i]; this.accN++; this.phase += 1;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.accN));
        this.acc = 0; this.accN = 0;
        this.frame[this.n++] = v < 0 ? v * 32768 : v * 32767;
        this.peak = Math.max(this.peak, Math.abs(v));
        if (this.n === ${FRAME_SAMPLES}) {
          const out = this.frame.slice(0);
          this.port.postMessage({ frame: out.buffer, peak: this.peak }, [out.buffer]);
          this.n = 0; this.peak = 0;
        }
      }
    }
    return true;
  }
}

class IntercomPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(${WIRE_RATE} * 8);
    this.read = 0; this.write = 0; this.size = 0; this.frac = 0;
    this.step = ${WIRE_RATE} / sampleRate;
    this.prebuffer = Math.round(${WIRE_RATE} * ${PLAYBACK_PREBUFFER_MS} / 1000);
    this.playing = false; this.underruns = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') { this.read = this.write = this.size = 0; this.playing = false; return; }
      const pcm = new Int16Array(e.data);
      for (let i = 0; i < pcm.length; i++) {
        if (this.size === this.buf.length) { this.read = (this.read + 1) % this.buf.length; this.size--; }
        this.buf[this.write] = pcm[i] / 32768;
        this.write = (this.write + 1) % this.buf.length; this.size++;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!this.playing && this.size >= this.prebuffer) this.playing = true;
    for (let i = 0; i < out.length; i++) {
      if (!this.playing || this.size < 2) {
        out[i] = 0;
        if (this.playing) { this.playing = false; this.underruns++; }
        continue;
      }
      const a = this.buf[this.read];
      const b = this.buf[(this.read + 1) % this.buf.length];
      out[i] = a + (b - a) * this.frac;
      this.frac += this.step;
      while (this.frac >= 1) {
        this.frac -= 1;
        this.read = (this.read + 1) % this.buf.length; this.size--;
      }
    }
    return true;
  }
}

registerProcessor('intercom-capture', IntercomCapture);
registerProcessor('intercom-player', IntercomPlayer);
`;

type ServerMessage =
  | { type: 'intercom.state'; state: 'requested' | 'connecting' | 'on' | 'off' }
  | { type: 'owner.talking'; on: boolean }
  | { type: 'intercom.ended'; reason: string };

function peakOf(pcm: Int16Array): number {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]);
    if (v > peak) peak = v;
  }
  return peak / 32768;
}

/**
 * Interfón directo con el visitante por `/intercom`.
 *
 * Se conecta solo mientras `enabled` (la consulta pidió el interfón). La
 * compuerta de voz vive en el servidor: aquí se manda el mic completo (con
 * cancelación de eco del navegador) y se reproduce lo que llega de la puerta.
 */
export type IntercomTarget =
  /** Interfón de una consulta del timbre (`/intercom`). */
  | { kind: 'consult'; id: string }
  /** Hablar con la puerta sin que toquen (`/live`). */
  | { kind: 'live'; deviceId: number };

function targetUrl(target: IntercomTarget): string {
  const base = deriveWsUrl(API_BASE_URL);
  return target.kind === 'consult'
    ? `${base}/intercom?consultId=${encodeURIComponent(target.id)}`
    : `${base}/live?deviceId=${target.deviceId}`;
}

export function useIntercom(target: IntercomTarget | null, enabled: boolean) {
  // Clave estable: el efecto solo se reinicia si cambia a qué te conectas.
  const targetKey = target
    ? target.kind === 'consult'
      ? `c:${target.id}`
      : `l:${target.deviceId}`
    : null;
  const [status, setStatus] = useState<IntercomStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [ownerTalking, setOwnerTalking] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [pushToTalk, setPushToTalkState] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [visitorLevel, setVisitorLevel] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const micPeakRef = useRef(0);
  const visitorPeakRef = useRef(0);

  const sendControl = useCallback((message: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    if (!enabled || !target) {
      setStatus('idle');
      return undefined;
    }

    let disposed = false;
    let context: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let workletUrl: string | null = null;
    let ws: WebSocket | null = null;

    setStatus('connecting');
    setError(null);
    setOwnerTalking(false);

    const levelTimer = window.setInterval(() => {
      setMicLevel(micPeakRef.current);
      setVisitorLevel(visitorPeakRef.current);
      micPeakRef.current *= 0.5;
      visitorPeakRef.current *= 0.5;
    }, LEVEL_REFRESH_MS);

    const fail = (message: string) => {
      if (disposed) return;
      setError(message);
      setStatus('error');
    };

    void (async () => {
      try {
        stream = await requestMicrophone({ ...VOICE_AUDIO_CONSTRAINTS, channelCount: 1 });
        if (disposed) return;

        context = new AudioContext({ latencyHint: 'interactive' });
        workletUrl = URL.createObjectURL(
          new Blob([WORKLET_SOURCE], { type: 'application/javascript' }),
        );
        await context.audioWorklet.addModule(workletUrl);
        if (disposed) return;

        const source = context.createMediaStreamSource(stream);
        const capture = new AudioWorkletNode(context, 'intercom-capture');
        // Algunos navegadores no procesan un nodo sin salida conectada.
        const sink = context.createGain();
        sink.gain.value = 0;
        source.connect(capture).connect(sink).connect(context.destination);

        const player = new AudioWorkletNode(context, 'intercom-player', {
          outputChannelCount: [1],
        });
        player.connect(context.destination);
        if (context.state === 'suspended') {
          await context.resume();
        }

        const url = targetUrl(target);
        ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        capture.port.onmessage = (event: MessageEvent<{ frame: ArrayBuffer; peak: number }>) => {
          micPeakRef.current = Math.max(micPeakRef.current, event.data.peak);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(event.data.frame);
          }
        };

        ws.addEventListener('message', (event: MessageEvent<string | ArrayBuffer>) => {
          if (disposed) return;
          if (event.data instanceof ArrayBuffer) {
            visitorPeakRef.current = Math.max(
              visitorPeakRef.current,
              peakOf(new Int16Array(event.data)),
            );
            player.port.postMessage(event.data, [event.data]);
            return;
          }
          let message: ServerMessage;
          try {
            message = JSON.parse(event.data) as ServerMessage;
          } catch {
            return;
          }
          if (message.type === 'intercom.state') {
            setStatus(message.state === 'on' ? 'on' : 'connecting');
          } else if (message.type === 'owner.talking') {
            setOwnerTalking(message.on);
          } else if (message.type === 'intercom.ended') {
            setStatus('ended');
          }
        });

        ws.addEventListener('close', (event) => {
          if (disposed) return;
          if (event.code === 4403) {
            fail('La consulta ya no permite el interfón');
          } else if (event.code === 4404 || event.code === 4409) {
            fail(event.reason || 'No se pudo abrir la puerta');
          } else {
            setStatus('ended');
          }
        });
        ws.addEventListener('error', () => fail('Se perdió la conexión del interfón'));
      } catch (err) {
        fail(err instanceof Error ? err.message : 'No se pudo iniciar el interfón');
      }
    })();

    return () => {
      disposed = true;
      window.clearInterval(levelTimer);
      wsRef.current = null;
      ws?.close();
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
      if (workletUrl) URL.revokeObjectURL(workletUrl);
      micPeakRef.current = 0;
      visitorPeakRef.current = 0;
      setMicLevel(0);
      setVisitorLevel(0);
      setOwnerTalking(false);
      setMutedState(false);
      setPushToTalkState(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `target` va resumido en `targetKey`
  }, [targetKey, enabled]);

  const setMuted = useCallback(
    (next: boolean) => {
      setMutedState(next);
      sendControl({ type: 'mute', on: next });
    },
    [sendControl],
  );

  const setPushToTalk = useCallback(
    (next: boolean) => {
      setPushToTalkState(next);
      sendControl({ type: 'mode', mode: next ? 'ptt' : 'auto' });
    },
    [sendControl],
  );

  /** Mientras se mantiene presionado "Hablar" en modo push-to-talk. */
  const setTalkPressed = useCallback(
    (pressed: boolean) => sendControl({ type: 'ptt', on: pressed }),
    [sendControl],
  );

  /** `ai`: regresas con Jarvis (el visitante espera). `close`: cuelgas todo. */
  const stop = useCallback(
    (then: IntercomReturn) => sendControl({ type: 'stop', then }),
    [sendControl],
  );

  return {
    status,
    error,
    ownerTalking,
    muted,
    setMuted,
    pushToTalk,
    setPushToTalk,
    setTalkPressed,
    micLevel,
    visitorLevel,
    stop,
  };
}

export type IntercomControls = ReturnType<typeof useIntercom>;
