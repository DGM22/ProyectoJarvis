import { PcmStreamResampler, resamplePcm16 } from './pcm-resample';

describe('resamplePcm16', () => {
  it('returns the same buffer when rates match', () => {
    const input = Buffer.alloc(8);
    input.writeInt16LE(1000, 0);
    expect(resamplePcm16(input, 16000, 16000)).toBe(input);
  });

  it('upsamples 16k → 24k preserving approximate length ratio', () => {
    const samples = 160;
    const input = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
      input.writeInt16LE(i * 10, i * 2);
    }
    const output = resamplePcm16(input, 16000, 24000);
    expect(output.length / 2).toBe(240);
  });

  it('downsamples 24k → 16k', () => {
    const samples = 240;
    const input = Buffer.alloc(samples * 2);
    const output = resamplePcm16(input, 24000, 16000);
    expect(output.length / 2).toBe(160);
  });
});

function tone(
  freq: number,
  rate: number,
  samples: number,
  amp = 10000,
): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(
      Math.round(amp * Math.sin((2 * Math.PI * freq * i) / rate)),
      i * 2,
    );
  }
  return buf;
}

function rms(buf: Buffer, skip = 0): number {
  let acc = 0;
  let n = 0;
  for (let i = skip; i < buf.length / 2; i++) {
    const v = buf.readInt16LE(i * 2);
    acc += v * v;
    n++;
  }
  return Math.sqrt(acc / n);
}

describe('PcmStreamResampler', () => {
  it('gives the same output whether fed in chunks or all at once', () => {
    const input = tone(440, 24000, 4800);
    const whole = new PcmStreamResampler(24000, 16000).process(input);
    const chunked = new PcmStreamResampler(24000, 16000);
    const parts: Buffer[] = [];
    // Chunks de tamaño irregular, como los deltas de OpenAI.
    for (let off = 0, i = 0; off < input.length; i++) {
      const len = [962, 2400, 334, 1200][i % 4];
      parts.push(chunked.process(input.subarray(off, off + len)));
      off += len;
    }
    const joined = Buffer.concat(parts);
    expect(joined.length).toBe(whole.length);
    expect(joined.equals(whole)).toBe(true);
  });

  it('keeps ~2/3 of the samples when going 24k → 16k', () => {
    const out = new PcmStreamResampler(24000, 16000).process(
      tone(440, 24000, 2400),
    );
    expect(Math.abs(out.length / 2 - 1600)).toBeLessThanOrEqual(16);
  });

  it('preserves voice-band amplitude', () => {
    const out = new PcmStreamResampler(24000, 16000).process(
      tone(1000, 24000, 4800),
    );
    expect(rms(out, 64)).toBeGreaterThan((10000 / Math.SQRT2) * 0.95);
    expect(rms(out, 64)).toBeLessThan((10000 / Math.SQRT2) * 1.05);
  });

  it('filters content above the 8 kHz Nyquist instead of aliasing it', () => {
    const out = new PcmStreamResampler(24000, 16000).process(
      tone(10000, 24000, 4800),
    );
    // Con interpolación lineal esto se "dobla" a 6 kHz con casi toda su energía.
    expect(rms(out, 64)).toBeLessThan((10000 / Math.SQRT2) * 0.1);
  });

  it('upsamples 16k → 24k', () => {
    const out = new PcmStreamResampler(16000, 24000).process(
      tone(440, 16000, 1600),
    );
    expect(Math.abs(out.length / 2 - 2400)).toBeLessThanOrEqual(24);
  });
});
