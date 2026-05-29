import { useEffect, useState } from "react";

const BAR_COUNT = 40;

function emptyLevels(): number[] {
  return Array(BAR_COUNT).fill(0.12);
}

/** Níveis de amplitude do microfone (0–1) atualizados via AnalyserNode + rAF. */
export function useMicWaveform(active: boolean, stream: MediaStream | null): number[] {
  const [levels, setLevels] = useState(emptyLevels);

  useEffect(() => {
    if (!active || !stream) {
      setLevels(emptyLevels());
      return;
    }

    let cancelled = false;
    let ctx: AudioContext | null = null;
    let raf = 0;
    const history = emptyLevels();

    void (async () => {
      try {
        ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume();

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.72;
        analyser.minDecibels = -85;
        analyser.maxDecibels = -12;
        source.connect(analyser);

        const buf = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (cancelled) return;
          analyser.getByteFrequencyData(buf);
          let sum = 0;
          const end = Math.min(56, buf.length);
          for (let i = 2; i < end; i++) sum += buf[i];
          const avg = sum / (end - 2) / 255;
          const level = Math.max(0.1, Math.min(1, avg * 3.4 + 0.06));
          history.shift();
          history.push(level);
          setLevels([...history]);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        /* analyser indisponível — mantém barras estáticas */
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      void ctx?.close();
      setLevels(emptyLevels());
    };
  }, [active, stream]);

  return levels;
}

export const MIC_WAVEFORM_BAR_COUNT = BAR_COUNT;
