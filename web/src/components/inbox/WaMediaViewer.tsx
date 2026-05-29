import { memo, useCallback, useEffect, useState } from "react";

type Props = {
  src: string;
  kind: "image" | "video" | "sticker";
  caption?: string;
};

export const WaMediaViewer = memo(function WaMediaViewer({ src, kind, caption }: Props) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  const thumbClass =
    kind === "video"
      ? "wa-media-thumb block w-full min-w-[260px] max-w-[min(100%,380px)] rounded-xl bg-black/30 cursor-pointer"
      : "wa-media-thumb block w-full min-w-[220px] max-w-[min(100%,380px)] rounded-xl cursor-zoom-in object-contain max-h-[420px]";

  return (
    <>
      {kind === "video" ? (
        <button type="button" className="relative group w-full text-left" onClick={() => setOpen(true)}>
          <video
            src={src}
            preload="metadata"
            playsInline
            className={`${thumbClass} max-h-[420px] pointer-events-none`}
          />
          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/25 opacity-90 group-hover:bg-black/35 transition-colors">
            <span className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center">
              <span className="w-0 h-0 border-y-[10px] border-y-transparent border-l-[16px] border-l-white ml-1" />
            </span>
          </span>
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="block w-full">
          <img src={src} alt="" loading="lazy" decoding="async" className={thumbClass} />
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b141a]/95 p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Visualizar mídia"
        >
          <button
            type="button"
            onClick={close}
            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-[#202c33] text-[#e9edef] text-2xl leading-none hover:bg-[#2a3942]"
            aria-label="Fechar"
          >
            ×
          </button>
          <div
            className="max-w-[min(96vw,900px)] max-h-[92vh] flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            {kind === "video" ? (
              <video
                src={src}
                controls
                autoPlay
                playsInline
                className="max-w-full max-h-[85vh] rounded-lg bg-black shadow-2xl"
              />
            ) : (
              <img
                src={src}
                alt=""
                className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
              />
            )}
            {caption && (
              <p className="text-sm text-[#e9edef] text-center max-w-lg whitespace-pre-wrap">{caption}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
});
