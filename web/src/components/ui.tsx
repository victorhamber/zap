/**
 * Primitivos de UI do painel.
 *
 * A ideia: nenhuma tela deve escolher um `border-zinc-XXX` novo por conta
 * própria. Tudo que aparece em mais de um lugar (card, botão, badge, estado
 * vazio, skeleton) mora aqui, e as páginas só compõem.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/* ------------------------------------------------------------------ *
 * Ícones — traço, 24x24, herdam currentColor
 * ------------------------------------------------------------------ */

const ICON_PATHS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  flow: (
    <>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <path d="M6 7.5v9M8.5 5H13a2 2 0 0 1 2 2v3M8.5 19H13a2 2 0 0 0 2-2v-3" />
    </>
  ),
  chat: (
    <>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.6-4.7A8.4 8.4 0 0 1 3.5 11 8.4 8.4 0 0 1 12 2.6a8.4 8.4 0 0 1 9 8.9Z" />
    </>
  ),
  funnel: (
    <>
      <path d="M4 4h16l-6 8v6l-4 2v-8L4 4Z" />
    </>
  ),
  media: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L17 18" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="14" cy="18" r="2" />
    </>
  ),
  logout: (
    <>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 8 6 12l4 4M6 12h9" />
    </>
  ),
  chevronLeft: <path d="m14 6-6 6 6 6" />,
  chevronRight: <path d="m10 6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7M10 11v6M14 11v6" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m14.5 6.5 3 3" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-13.7-5.3L3 9" />
      <path d="M4 13a8 8 0 0 0 13.7 5.3L21 15" />
      <path d="M3 4v5h5M21 20v-5h-5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  check: <path d="m5 13 4 4L19 7" />,
  download: <path d="M12 4v11m0 0 4-4m-4 4-4-4M4 19h16" />,
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.2h.01" />
    </>
  ),
  activity: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14.4A6 6 0 0 1 21 20" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12.5V5a2 2 0 0 1 2-2h7.5a2 2 0 0 1 1.4.6l6.5 6.5a2 2 0 0 1 0 2.8l-7.5 7.5a2 2 0 0 1-2.8 0L3.6 13.9a2 2 0 0 1-.6-1.4Z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 2" />
    </>
  ),
  send: <path d="M4.5 12 20 4l-5 16-3.6-6.4L4.5 12Z" />,
  inbox: (
    <>
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M4.6 5.6 3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5l-1.6-7.4A2 2 0 0 0 17.4 4H6.6a2 2 0 0 0-2 1.6Z" />
    </>
  ),
  power: (
    <>
      <path d="M12 4v8" />
      <path d="M7.5 6.8a8 8 0 1 0 9 0" />
    </>
  ),
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3 9 9M15 15l2.7 2.7M17.7 6.3 15 9M9 15l-2.7 2.7" />,
  empty: (
    <>
      <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z" />
      <path d="M4 8.5 12 13l8-4.5M12 13v7" />
    </>
  )
};

export type IconName = keyof typeof ICON_PATHS;

export function Icon({
  name,
  className = "h-5 w-5",
  strokeWidth = 1.7
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Card
 * ------------------------------------------------------------------ */

export function Card({
  children,
  className = "",
  padded = true,
  interactive = false
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--line)] bg-[var(--surface-1)] shadow-[0_1px_2px_rgba(0,0,0,0.35)] ${
        padded ? "p-5" : ""
      } ${
        interactive
          ? "transition-colors duration-150 hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]/70"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-zinc-400 leading-normal">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Botões
 * ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-medium border border-emerald-500/30 shadow-xs disabled:opacity-50 disabled:hover:bg-emerald-600",
  secondary:
    "border border-[var(--line-strong)] bg-[var(--surface-2)] text-zinc-200 hover:bg-[var(--surface-3)] hover:text-white hover:border-zinc-500/50 shadow-xs font-medium",
  ghost: "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100 font-medium",
  danger:
    "border border-rose-500/25 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 hover:border-rose-500/40 font-medium"
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2"
};

function buttonClass(variant: ButtonVariant, size: ButtonSize, className = ""): string {
  return `inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150 select-none disabled:opacity-45 disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`;
}

export function Button({
  children,
  variant = "secondary",
  size = "md",
  icon,
  className = "",
  ...rest
}: {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={buttonClass(variant, size, className)} {...rest}>
      {icon && <Icon name={icon} className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />}
      {children}
    </button>
  );
}

export function LinkButton({
  children,
  to,
  variant = "secondary",
  size = "md",
  icon,
  className = ""
}: {
  children?: ReactNode;
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  className?: string;
}) {
  return (
    <Link to={to} className={buttonClass(variant, size, className)}>
      {icon && <Icon name={icon} className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />}
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * Badge / Input
 * ------------------------------------------------------------------ */

type BadgeTone = "neutral" | "success" | "danger" | "warning" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-zinc-800/80 text-zinc-300 border-zinc-700/60",
  success: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  danger: "bg-rose-500/10 text-rose-300 border-rose-500/20",
  warning: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  info: "bg-sky-500/10 text-sky-300 border-sky-500/20"
};

export function Badge({
  children,
  tone = "neutral",
  dot = false
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide ${BADGE_TONES[tone]}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

export const inputClass =
  "w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)]/70 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-emerald-500/50 focus:bg-[var(--surface-2)] focus:ring-1 focus:ring-emerald-500/30";

export function SearchInput({
  value,
  onChange,
  placeholder,
  className = ""
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Icon
        name="search"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`${inputClass} pl-9`}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Estruturas de página
 * ------------------------------------------------------------------ */

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-zinc-100">{title}</h1>
        {subtitle && (
          <p className="mt-1 max-w-2xl text-xs md:text-sm leading-relaxed text-zinc-400">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`zap-skeleton ${className}`} />;
}

export function EmptyState({
  icon = "empty",
  title,
  description,
  action
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--surface-1)]/40 px-6 py-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-zinc-400">
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <p className="mt-3.5 text-sm font-medium text-zinc-200">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-400">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3.5 py-2.5 text-xs md:text-sm text-rose-200"
    >
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
