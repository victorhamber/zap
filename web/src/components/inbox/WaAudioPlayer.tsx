import { memo, useEffect, useMemo, useRef, useState } from "react";

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const BAR_COUNT = 32;
const BAR_HEIGHTS = [3, 5, 4, 6, 3, 5, 7, 4, 6, 3, 5, 4, 6, 3, 5, 8, 4, 5, 3, 6, 4, 5, 7, 3, 5, 4, 6, 3, 5, 4, 6, 5];

const PLAYBACK_SPEEDS = [1, 1.5, 2] as const;

function formatSpeed(rate: number): string {
  return rate === 1 ? "1×" : `${rate}×`.replace(".", ",");
}

type Props = {
  src: string;
  fromMe?: boolean;
};

export const WaAudioPlayer = memo(function WaAudioPlayer({ src, fromMe }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const rafRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [speed, setSpeed] = useState<(typeof PLAYBACK_SPEEDS)[number]>(1);

  const bars = useMemo(() => BAR_HEIGHTS.slice(0, BAR_COUNT), []);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = speed;
  }, [speed, src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const syncTime = () => {
      const d = el.duration || 0;
      const t = el.currentTime;
      setCurrent(t);
      setProgress(d ? (t / d) * 100 : 0);
    };

    const tick = () => {
      syncTime();
      if (!el.paused && !el.ended) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    const onMeta = () => {
      setDuration(el.duration || 0);
      syncTime();
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
      syncTime();
    };
    const onEnded = () => {
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
      setProgress(0);
      setCurrent(0);
    };

    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      cancelAnimationFrame(rafRef.current);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [src]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const cycleSpeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSpeed((prev) => {
      const idx = PLAYBACK_SPEEDS.indexOf(prev);
      return PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length];
    });
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
    const p = ratio * 100;
    setProgress(p);
    setCurrent(ratio * el.duration);
  };

  const accent = fromMe ? "bg-[#53bdeb]" : "bg-[#00a884]";
  const barIdle = fromMe ? "bg-[#99beb7]" : "bg-[#8696a0]";
  const barActive = fromMe ? "bg-[#d9fdd3]" : "bg-[#e9edef]";
  const playheadRatio = progress / 100;

  return (
    <div className="wa-audio-player flex items-center gap-2.5 min-w-[200px] max-w-[280px] py-0.5">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${accent} text-[#111b21] hover:opacity-90`}
        aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
      >
        {playing ? (
          <span className="flex gap-0.5">
            <span className="w-0.5 h-3 bg-[#111b21] rounded-sm" />
            <span className="w-0.5 h-3 bg-[#111b21] rounded-sm" />
          </span>
        ) : (
          <span className="w-0 h-0 border-y-[6px] border-y-transparent border-l-[10px] border-l-[#111b21] ml-0.5" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className="flex items-end gap-[2px] h-6 cursor-pointer"
          onClick={seek}
          role="slider"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={String(Math.round(progress))}
          aria-label="Posição do áudio"
        >
          {bars.map((h, i) => {
            const pos = (i + 0.5) / bars.length;
            const played = pos <= playheadRatio;
            const pulse = playing && played && Math.abs(pos - playheadRatio) < 0.08 ? 2 : 0;
            return (
              <span
                key={i}
                className={`w-[3px] rounded-full ${played ? barActive : barIdle}`}
                style={{
                  height: `${h + pulse}px`,
                  opacity: played ? 1 : 0.42
                }}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2 text-[10px] text-[#8696a0] mt-0.5 tabular-nums">
          <span>{formatDuration(current)}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cycleSpeed}
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums transition ${
                speed > 1
                  ? fromMe
                    ? "bg-[#d9fdd3]/20 text-[#d9fdd3]"
                    : "bg-[#00a884]/20 text-[#00a884]"
                  : "text-[#8696a0] hover:bg-[#ffffff0a]"
              }`}
              title="Velocidade de reprodução (clique para alternar)"
              aria-label={`Velocidade ${formatSpeed(speed)}`}
            >
              {formatSpeed(speed)}
            </button>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
});
