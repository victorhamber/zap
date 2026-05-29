import { memo, useEffect, useRef, useState } from "react";

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  src: string;
  fromMe?: boolean;
};

export const WaAudioPlayer = memo(function WaAudioPlayer({ src, fromMe }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onMeta = () => setDuration(el.duration || 0);
    const onTime = () => {
      setCurrent(el.currentTime);
      setProgress(el.duration ? (el.currentTime / el.duration) * 100 : 0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
      setCurrent(0);
    };

    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("timeupdate", onTime);
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

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
  };

  const accent = fromMe ? "bg-[#53bdeb]" : "bg-[#00a884]";
  const bars = [3, 5, 4, 6, 3, 5, 4, 7, 3, 5, 4, 6, 3, 5, 4, 5, 3, 4, 5, 3];

  return (
    <div className="wa-audio-player flex items-center gap-3 min-w-[220px] max-w-[320px] py-0.5">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${accent} text-[#111b21] hover:opacity-90 transition-opacity`}
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
        <div className="flex items-end gap-[2px] h-6 mb-1 opacity-80">
          {bars.map((h, i) => (
            <span
              key={i}
              className={`w-[3px] rounded-full ${fromMe ? "bg-[#99beb7]" : "bg-[#8696a0]"}`}
              style={{
                height: `${h + (playing && i / bars.length <= progress / 100 ? 2 : 0)}px`,
                opacity: i / bars.length <= progress / 100 ? 1 : 0.45
              }}
            />
          ))}
        </div>
        <div className="h-1 rounded-full bg-white/10 cursor-pointer" onClick={seek}>
          <div
            className={`h-full rounded-full ${accent}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-[#8696a0] mt-0.5">
          <span>{formatDuration(current)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>
    </div>
  );
});
