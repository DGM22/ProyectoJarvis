/**
 * AudioWorkletProcessor that captures microphone audio, resamples it to
 * 16 kHz mono, converts to 16-bit signed PCM, and posts chunks of 1280
 * samples (80 ms) to the main thread as ArrayBuffer messages.
 */
class WakeWordProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(0);
    this._targetRate = 16000;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const inData = input[0]; // mono channel (Float32)
    const ratio = this._targetRate / sampleRate;

    // Simple linear-interpolation resample
    const outLen = Math.round(inData.length * ratio);
    const resampled = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i / ratio;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, inData.length - 1);
      const frac = srcIdx - lo;
      resampled[i] = inData[lo] * (1 - frac) + inData[hi] * frac;
    }

    // Append to accumulation buffer
    const prev = this._buffer;
    const merged = new Float32Array(prev.length + resampled.length);
    merged.set(prev);
    merged.set(resampled, prev.length);
    this._buffer = merged;

    // Emit complete 1280-sample frames
    const FRAME = 1280;
    while (this._buffer.length >= FRAME) {
      const frame = this._buffer.slice(0, FRAME);
      this._buffer = this._buffer.slice(FRAME);

      // Convert Float32 [-1,1] to Int16
      const pcm = new Int16Array(FRAME);
      for (let i = 0; i < FRAME; i++) {
        const s = Math.max(-1, Math.min(1, frame[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }

    return true;
  }
}

registerProcessor('wake-word-processor', WakeWordProcessor);
