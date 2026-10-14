/** 20 ms de PCM16 16 kHz: el tamaño de frame que manda la web. */
const FRAME_SAMPLES = 320;
/** Arriba de esto (RMS) cuenta como voz; la web ya aplica AGC y supresión de ruido. */
const OPEN_DBFS = -42;
/** Tras la última sílaba la compuerta sigue abierta este tiempo (no corta palabras). */
const HANGOVER_MS = 450;
/** Frames previos que se mandan al abrir, para no comerse el inicio de la palabra. */
const PREROLL_FRAMES = 3;

export type GateMode = 'auto' | 'ptt';

/**
 * Compuerta de voz del dueño en el interfón (half-duplex).
 *
 * La puerta no tiene cancelación de eco: si se le manda silencio o ruido
 * continuo, su bocina nunca se apaga y el mic del visitante nunca se abre.
 * Solo se reenvía la voz real del dueño; en modo `ptt` manda el botón.
 */
export class OwnerVoiceGate {
  private open = false;
  private lastVoiceAt = Number.NEGATIVE_INFINITY;
  private preroll: Buffer[] = [];
  private mode: GateMode = 'auto';
  private pttPressed = false;
  private muted = false;

  setMode(mode: GateMode): void {
    this.mode = mode;
    this.pttPressed = false;
  }

  setPtt(pressed: boolean): void {
    this.pttPressed = pressed;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * @returns frames a reenviar a la puerta y si la compuerta cambió de estado.
   */
  process(
    frame: Buffer,
    now = Date.now(),
  ): { forward: Buffer[]; changed: boolean } {
    const wasOpen = this.open;
    let wantOpen: boolean;

    if (this.muted) {
      wantOpen = false;
    } else if (this.mode === 'ptt') {
      wantOpen = this.pttPressed;
    } else {
      if (rmsDbfs(frame) > OPEN_DBFS) {
        this.lastVoiceAt = now;
      }
      wantOpen = now - this.lastVoiceAt < HANGOVER_MS;
    }

    this.open = wantOpen;
    let forward: Buffer[] = [];
    if (wantOpen) {
      forward = wasOpen ? [frame] : [...this.preroll, frame];
      this.preroll = [];
    } else {
      this.preroll.push(frame);
      if (this.preroll.length > PREROLL_FRAMES) {
        this.preroll.shift();
      }
    }
    return { forward, changed: wasOpen !== this.open };
  }
}

export function rmsDbfs(frame: Buffer): number {
  const samples = Math.floor(frame.length / 2);
  if (samples === 0) {
    return -120;
  }
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const v = frame.readInt16LE(i * 2);
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples);
  return rms <= 0 ? -120 : 20 * Math.log10(rms / 32768);
}

export const OWNER_FRAME_BYTES = FRAME_SAMPLES * 2;
