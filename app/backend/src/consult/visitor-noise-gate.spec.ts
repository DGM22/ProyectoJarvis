import { VisitorNoiseGate } from './visitor-noise-gate';

const SAMPLES = 320; // 20 ms a 16 kHz

function sine(freq: number, amplitude: number): Buffer {
  const buf = Buffer.alloc(SAMPLES * 2);
  for (let i = 0; i < SAMPLES; i++) {
    buf.writeInt16LE(
      Math.round(amplitude * Math.sin((2 * Math.PI * freq * i) / 16000)),
      i * 2,
    );
  }
  return buf;
}

/** Ruido blanco determinista (como los bits corruptos del mic). */
function whiteNoise(amplitude: number, seed = 1): Buffer {
  const buf = Buffer.alloc(SAMPLES * 2);
  let x = seed;
  for (let i = 0; i < SAMPLES; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    buf.writeInt16LE(Math.round(((x / 0x7fffffff) * 2 - 1) * amplitude), i * 2);
  }
  return buf;
}

function peak(buf: Buffer): number {
  let p = 0;
  for (let i = 0; i < buf.length / 2; i++)
    p = Math.max(p, Math.abs(buf.readInt16LE(i * 2)));
  return p;
}

describe('VisitorNoiseGate', () => {
  it('silences loud white noise (the "gray noise" from a corrupted mic)', () => {
    const gate = new VisitorNoiseGate();
    let out: Buffer = Buffer.alloc(0);
    for (let t = 0; t < 400; t += 20)
      out = gate.process(whiteNoise(12000, t + 1), t);
    expect(peak(out)).toBe(0);
  });

  it('lets voice-like audio through after a short fade-in', () => {
    const gate = new VisitorNoiseGate();
    gate.process(sine(300, 8000), 0); // rampa de entrada
    const out = gate.process(sine(300, 8000), 20);
    expect(peak(out)).toBeGreaterThan(7000);
  });

  it('silences quiet hiss between words', () => {
    const gate = new VisitorNoiseGate();
    let out: Buffer = Buffer.alloc(0);
    for (let t = 0; t < 400; t += 20) out = gate.process(sine(300, 60), t); // ≈ -55 dBFS
    expect(peak(out)).toBe(0);
  });

  it('keeps the end of a word open during the hangover, then closes', () => {
    const gate = new VisitorNoiseGate();
    gate.process(sine(300, 8000), 0);
    gate.process(sine(300, 8000), 20);
    expect(peak(gate.process(whiteNoise(200), 200))).toBeGreaterThan(0);
    gate.process(whiteNoise(200), 600);
    expect(peak(gate.process(whiteNoise(200), 620))).toBe(0);
  });
});
