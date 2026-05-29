import { memo } from "react";

type Props = {
  levels: number[];
  className?: string;
  barClassName?: string;
  minPx?: number;
  maxPx?: number;
};

/** Barras verticais estilo WhatsApp Web (ondulações do microfone). */
export const MicWaveform = memo(function MicWaveform({
  levels,
  className = "",
  barClassName = "bg-[#e9edef]",
  minPx = 4,
  maxPx = 24
}: Props) {
  return (
    <div
      className={`flex items-center gap-[2px] flex-1 min-w-0 h-7 overflow-hidden justify-end ${className}`}
      aria-hidden
    >
      {levels.map((level, i) => {
        const h = minPx + level * (maxPx - minPx);
        return (
          <span
            key={i}
            className={`w-[3px] rounded-full shrink-0 ${barClassName}`}
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
});
