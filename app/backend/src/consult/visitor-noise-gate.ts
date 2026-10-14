/** Debajo de esto (RMS) no hay voz del visitante: es el siseo del mic. */
const OPEN_DBFS = -48;
/**
 * Relación energía(diferencia entre muestras) / energía(señal). La voz a
 * 16 kHz se concentra debajo de ~4 kHz y cambia suave (≈0.3–0.9); el ruido
 * blanco o los bits corruptos del INMP441 saltan de muestra en muestra (≈1.4).
 */
const MAX_VOICE_DIFF_RATIO = 1.05;
/** Tras la última sílaba sigue abierto (no corta finales de palabra). */
const HANGOVER_MS = 300;
/** Rampa de ganancia por muestra: ~5 ms para abrir/cerrar sin chasquido. */
const GAIN_STEP = 1 / 80;
const REPORT_MS = 5000;

export interface VisitorGateReport {
  frames: number;
  voicePct: number;
  avgRmsDbfs: number;
  avgDiffRatio: number;
}

/**
 * Compuerta de ruido para la voz del visitante hacia el dueño (interfón).
 *
 * El mic de la puerta trae siseo y, con cableado largo, ráfagas de bits
 * corruptos que en el oído suenan a "ruido gris" fuerte. Solo pasan los frames
 * que parecen voz; el resto se silencia con rampa.
 */
export class VisitorNoiseGate {
  private lastVoiceAt = Number.NEGATIVE_INFINITY;
  private gain = 0;
  private stats = { frames: 0, voice: 0, rmsDb: 0, diffRatio: 0 };
  private lastReportAt = Date.now();

  constructor(
    private readonly onReport?: (report: VisitorGateReport) => void,
  ) {}

  process(frame: Buffer, now = Date.now()): Buffer {
    const samples = Math.floor(frame.length / 2);
    if (samples < 2) {
      return frame;
    }

    let sum = 0;
    let diffSum = 0;
    let prev = frame.readInt16LE(0);
    sum += prev * prev;
    for (let i = 1; i < samples; i++) {
      const v = frame.readInt16LE(i * 2);
      sum += v * v;
      const d = v - prev;
      diffSum += d * d;
      prev = v;
    }
    const rms = Math.sqrt(sum / samples);
    const rmsDb = rms <= 0 ? -120 : 20 * Math.log10(rms / 32768);
    const diffRatio = rms <= 0 ? 0 : Math.sqrt(diffSum / (samples - 1)) / rms;

    const isVoice = rmsDb > OPEN_DBFS && diffRatio < MAX_VOICE_DIFF_RATIO;
    if (isVoice) {
      this.lastVoiceAt = now;
    }
    const target = now - this.lastVoiceAt < HANGOVER_MS ? 1 : 0;

    this.track(now, isVoice, rmsDb, diffRatio);

    // Cerrado y sin rampa pendiente: silencio directo.
    if (target === 0 && this.gain === 0) {
      return Buffer.alloc(samples * 2);
    }

    const out = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
      if (this.gain < target) {
        this.gain = Math.min(target, this.gain + GAIN_STEP);
      } else if (this.gain > target) {
        this.gain = Math.max(target, this.gain - GAIN_STEP);
      }
      out.writeInt16LE(Math.round(frame.readInt16LE(i * 2) * this.gain), i * 2);
    }
    return out;
  }

  private track(
    now: number,
    isVoice: boolean,
    rmsDb: number,
    diffRatio: number,
  ): void {
    this.stats.frames++;
    this.stats.voice += isVoice ? 1 : 0;
    this.stats.rmsDb += rmsDb;
    this.stats.diffRatio += diffRatio;
    if (!this.onReport || now - this.lastReportAt < REPORT_MS) {
      return;
    }
    const { frames, voice } = this.stats;
    this.onReport({
      frames,
      voicePct: Math.round((voice / frames) * 100),
      avgRmsDbfs: this.stats.rmsDb / frames,
      avgDiffRatio: this.stats.diffRatio / frames,
    });
    this.stats = { frames: 0, voice: 0, rmsDb: 0, diffRatio: 0 };
    this.lastReportAt = now;
  }
}
