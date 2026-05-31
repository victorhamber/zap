import { memo } from "react";

const URL_RE = /(?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?'")\]}>]/gi;

function normalizeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function splitTrailingPunctuation(url: string): { core: string; trailing: string } {
  let core = url;
  let trailing = "";
  while (/[.,;:!?)>\]}"']$/.test(core)) {
    trailing = core.slice(-1) + trailing;
    core = core.slice(0, -1);
  }
  return { core, trailing };
}

type Props = {
  text: string;
  className?: string;
  linkClassName?: string;
};

export const LinkifyText = memo(function LinkifyText({
  text,
  className,
  linkClassName = "text-[#53bdeb] hover:underline break-all"
}: Props) {
  if (!text) return null;

  const parts: React.ReactNode[] = [];
  let last = 0;
  const re = new RegExp(URL_RE.source, "gi");
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const idx = match.index;
    if (idx > last) parts.push(text.slice(last, idx));

    const raw = match[0];
    const { core, trailing } = splitTrailingPunctuation(raw);
    parts.push(
      <a
        key={`${idx}-${core}`}
        href={normalizeHref(core)}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName}
        onClick={(e) => e.stopPropagation()}
      >
        {core}
      </a>
    );
    if (trailing) parts.push(trailing);
    last = idx + raw.length;
  }

  if (last < text.length) parts.push(text.slice(last));

  if (parts.length === 0) {
    return <span className={className}>{text}</span>;
  }

  return <span className={className}>{parts}</span>;
});
