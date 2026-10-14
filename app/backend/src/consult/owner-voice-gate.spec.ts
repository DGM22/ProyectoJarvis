import { OwnerVoiceGate } from './owner-voice-gate';

/** Frame de 20 ms (320 muestras) con amplitud constante. */
function frame(amplitude: number): Buffer {
  const buf = Buffer.alloc(640);
  for (let i = 0; i < 320; i++) {
    buf.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2);
  }
  return buf;
}

const SILENCE = frame(0);
const VOICE = frame(6000); // ≈ -15 dBFS

describe('OwnerVoiceGate', () => {
  it('drops silence so the door speaker turns off and the visitor can talk', () => {
    const gate = new OwnerVoiceGate();
    for (let t = 0; t < 1000; t += 20) {
      expect(gate.process(SILENCE, t).forward).toHaveLength(0);
    }
    expect(gate.isOpen).toBe(false);
  });

  it('opens on voice with pre-roll and stays open through the hangover', () => {
    const gate = new OwnerVoiceGate();
    gate.process(SILENCE, 0);
    gate.process(SILENCE, 20);

    const opened = gate.process(VOICE, 40);
    expect(opened.changed).toBe(true);
    expect(opened.forward).toHaveLength(3); // 2 de pre-roll + el actual

    expect(gate.process(SILENCE, 300).forward).toHaveLength(1);
    const closed = gate.process(SILENCE, 600);
    expect(closed.changed).toBe(true);
    expect(gate.isOpen).toBe(false);
  });

  it('push-to-talk ignores voice level and follows the button', () => {
    const gate = new OwnerVoiceGate();
    gate.setMode('ptt');
    expect(gate.process(VOICE, 0).forward).toHaveLength(0);

    gate.setPtt(true);
    expect(gate.process(SILENCE, 20).forward.length).toBeGreaterThan(0);
  });

  it('mute wins over everything', () => {
    const gate = new OwnerVoiceGate();
    gate.setMuted(true);
    expect(gate.process(VOICE, 0).forward).toHaveLength(0);
  });
});
