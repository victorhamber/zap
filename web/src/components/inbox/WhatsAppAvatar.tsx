import { memo, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";

type Props = {
  chatId: string;
  isGroup?: boolean;
  name: string;
  size?: number;
  className?: string;
};

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export const WhatsAppAvatar = memo(function WhatsAppAvatar({
  chatId,
  isGroup,
  name,
  size = 48,
  className = ""
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUrl(null);
    const el = ref.current;
    if (!el) return;

    let cancelled = false;

    const load = () => {
      if (cancelled) return;
      void api<{ url: string | null }>(
        `/api/inbox/avatar?chatId=${encodeURIComponent(chatId)}&isGroup=${isGroup ? "1" : "0"}`
      )
        .then((r) => {
          if (!cancelled) setUrl(r.url);
        })
        .catch(() => {
          if (!cancelled) setUrl(null);
        });
    };

    if (typeof IntersectionObserver === "undefined") {
      load();
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          load();
          io.disconnect();
        }
      },
      { rootMargin: "80px" }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [chatId, isGroup]);

  const px = `${size}px`;
  const font = size >= 40 ? "text-sm" : "text-xs";

  return (
    <div
      ref={ref}
      className={`shrink-0 rounded-full bg-[#6b7c85] flex items-center justify-center overflow-hidden text-white font-semibold ${font} ${className}`}
      style={{ width: px, height: px }}
      aria-hidden
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
      ) : (
        initials(name)
      )}
    </div>
  );
});
