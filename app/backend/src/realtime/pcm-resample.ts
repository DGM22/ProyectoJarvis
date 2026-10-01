/**
 * Remuestrea PCM16 LE mono entre tasas enteras con interpolación lineal.
 *
 * El ESP32 trabaja a 16 kHz; OpenAI Realtime WS suele usar 24 kHz. Mantener
 * ambas tasas en un solo sitio evita drift entre bridge y firmware.
 */
export function resamplePcm16(
  input: Buffer,
  fromRate: number,
  toRate: number,
): Buffer {
  if (fromRate === toRate || input.length < 2) {
    return input;
  }

  const inputSamples = input.length / 2;
  const outputSamples = Math.max(
    1,
    Math.round((inputSamples * toRate) / fromRate),
  );
  const output = Buffer.alloc(outputSamples * 2);
  const ratio = inputSamples / outputSamples;

  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i * ratio;
    const left = Math.floor(srcPos);
    const right = Math.min(left + 1, inputSamples - 1);
    const frac = srcPos - left;
    const a = input.readInt16LE(left * 2);
    const b = input.readInt16LE(right * 2);
    const sample = Math.round(a + (b - a) * frac);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }

  return output;
}

const SINC_HALF_TAPS = 16;
const SINC_PHASES = 256;

/**
 * Remuestreador PCM16 LE mono con estado para streams (audio en chunks).
 *
 * A diferencia de `resamplePcm16`, conserva historia entre chunks (sin saltos
 * en las uniones) y aplica un filtro windowed-sinc paso-bajas, así que al bajar
 * 24 kHz → 16 kHz no hay aliasing (el "ruido gris" en el speaker del ESP32).
 * Usar una instancia por dirección y por sesión.
 */
export class PcmStreamResampler {
  private readonly step: number;
  private readonly table: Float32Array;
  private history = new Float32Array(SINC_HALF_TAPS * 2);
  /** Posición (en muestras de `history`) de la próxima muestra de salida. */
  private pos = SINC_HALF_TAPS;

  constructor(
    private readonly fromRate: number,
    private readonly toRate: number,
  ) {
    this.step = fromRate / toRate;
    // Corte algo debajo del Nyquist de la tasa menor para dejar banda de transición.
    const cutoff = Math.min(1, toRate / fromRate) * 0.9;
    const taps = SINC_HALF_TAPS * 2;
    this.table = new Float32Array((SINC_PHASES + 1) * taps);
    for (let phase = 0; phase <= SINC_PHASES; phase++) {
      const frac = phase / SINC_PHASES;
      let sum = 0;
      for (let k = 0; k < taps; k++) {
        const t = k - (SINC_HALF_TAPS - 1) - frac;
        const x = Math.PI * cutoff * t;
        const sinc = t === 0 ? 1 : Math.sin(x) / x;
        const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / SINC_HALF_TAPS);
        const v = cutoff * sinc * w;
        this.table[phase * taps + k] = v;
        sum += v;
      }
      // Normaliza ganancia DC por fase para no introducir ripple entre fases.
      for (let k = 0; k < taps; k++) {
        this.table[phase * taps + k] /= sum;
      }
    }
  }

  process(input: Buffer): Buffer {
    if (this.fromRate === this.toRate) {
      return input;
    }
    const inSamples = Math.floor(input.length / 2);
    const buf = new Float32Array(this.history.length + inSamples);
    buf.set(this.history, 0);
    for (let i = 0; i < inSamples; i++) {
      buf[this.history.length + i] = input.readInt16LE(i * 2);
    }

    const taps = SINC_HALF_TAPS * 2;
    const out: number[] = [];
    let pos = this.pos;
    while (Math.floor(pos) + SINC_HALF_TAPS < buf.length) {
      const base = Math.floor(pos);
      const phase = Math.round((pos - base) * SINC_PHASES);
      const start = base - (SINC_HALF_TAPS - 1);
      let acc = 0;
      for (let k = 0; k < taps; k++) {
        acc += buf[start + k] * this.table[phase * taps + k];
      }
      out.push(acc);
      pos += this.step;
    }

    // Conserva solo lo necesario para las próximas salidas.
    const keepFrom = Math.max(0, Math.floor(pos) - (SINC_HALF_TAPS - 1));
    this.history = buf.slice(keepFrom);
    this.pos = pos - keepFrom;

    const output = Buffer.alloc(out.length * 2);
    for (let i = 0; i < out.length; i++) {
      output.writeInt16LE(
        Math.max(-32768, Math.min(32767, Math.round(out[i]))),
        i * 2,
      );
    }
    return output;
  }
}

/** Codifica PCM binario a base64 para eventos Realtime. */
export function pcmToBase64(pcm: Buffer): string {
  return pcm.toString('base64');
}

/** Decodifica un delta de audio base64 de OpenAI a PCM. */
export function base64ToPcm(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}
