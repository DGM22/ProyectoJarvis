import { useEffect } from 'react';

const BEEP_EVERY_MS = 1600;

/**
 * Tono de timbre con WebAudio mientras `active`. Si el navegador bloquea el
 * audio sin gesto previo, falla en silencio (el overlay visual sigue ahí).
 */
export function useRingtone(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;

    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtor) return undefined;

    const ctx = new AudioCtor();
    void ctx.resume().catch(() => undefined);

    const ding = () => {
      if (ctx.state !== 'running') return;
      const now = ctx.currentTime;
      [880, 660].forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'sine';
        const start = now + index * 0.28;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.3);
      });
    };

    ding();
    const id = window.setInterval(ding, BEEP_EVERY_MS);

    return () => {
      window.clearInterval(id);
      void ctx.close().catch(() => undefined);
    };
  }, [active]);
}
