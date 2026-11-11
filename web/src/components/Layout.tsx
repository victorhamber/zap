import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { clearToken } from "../api/client";
import { Icon, type IconName } from "./ui";

const NAV_COLLAPSED_KEY = "zap-nav-collapsed";

const links: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/flows", label: "Fluxos", icon: "flow" },
  { to: "/whatsapp", label: "WhatsApp", icon: "chat" },
  { to: "/funil", label: "Funil", icon: "funnel" },
  { to: "/media", label: "Mídias", icon: "media" },
  { to: "/settings", label: "Configurações", icon: "settings" }
];

function isActive(pathname: string, to: string): boolean {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function Layout() {
  const loc = useLocation();
  const isInbox = loc.pathname.startsWith("/whatsapp");
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
  );

  // Em telas estreitas a barra fica sempre recolhida — 256px de menu num
  // celular não sobra largura pra tabela/inbox do lado.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const railOnly = collapsed || narrow;

  return (
    <div className={`flex ${isInbox ? "h-screen overflow-hidden" : "min-h-screen"}`}>
      <aside
        className={`flex shrink-0 flex-col border-r border-[var(--line)] bg-[var(--surface-1)] transition-[width] duration-200 ease-out ${
          railOnly ? "w-[68px]" : "w-60"
        }`}
      >
        {/* Marca */}
        <div className={`border-b border-[var(--line)] ${railOnly ? "px-2.5 py-3.5" : "px-4 py-4"}`}>
          <Link
            to="/"
            className={`flex items-center ${railOnly ? "justify-center" : "gap-2.5"}`}
            title="Zap — Automação WhatsApp"
          >
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-zinc-900 text-emerald-400 shadow-xs">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
              </svg>
            </span>
            {!railOnly && (
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold tracking-tight text-zinc-100">Zap</span>
                  <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-1 py-0.2 text-[9px] font-medium text-emerald-400">
                    PRO
                  </span>
                </span>
                <span className="block truncate text-[11px] text-zinc-400">
                  Automação WhatsApp
                </span>
              </span>
            )}
          </Link>
        </div>

        {/* Navegação */}
        <nav className={`flex-1 space-y-1 ${railOnly ? "px-2 py-3" : "px-2.5 py-3"}`}>
          {!railOnly && (
            <p className="px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              Painel
            </p>
          )}
          {links.map((l) => {
            const active = isActive(loc.pathname, l.to);
            return (
              <Link
                key={l.to}
                to={l.to}
                title={railOnly ? l.label : undefined}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center rounded-lg transition-colors duration-150 ${
                  railOnly ? "h-10 justify-center" : "gap-2.5 px-2.5 py-2 text-xs md:text-sm font-medium"
                } ${
                  active
                    ? "bg-white/[0.08] text-white shadow-xs"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                }`}
              >
                <Icon
                  name={l.icon}
                  className={`${railOnly ? "h-5 w-5" : "h-4 w-4"} ${
                    active ? "text-emerald-400" : "text-zinc-400 group-hover:text-zinc-300"
                  }`}
                />
                {!railOnly && <span>{l.label}</span>}
                {!railOnly && active && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Rodapé */}
        <div className={`space-y-1.5 border-t border-[var(--line)] ${railOnly ? "p-2" : "p-3"}`}>
          {!railOnly && (
            <div className="mb-2 flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/60 px-2.5 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
                <span className="truncate text-[11px] text-zinc-300">Sistema ativo</span>
              </div>
              <Link to="/settings" className="text-[10px] text-zinc-500 transition-colors hover:text-emerald-400">
                Status
              </Link>
            </div>
          )}
          {!narrow && (
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? "Expandir menu" : "Recolher menu"}
              aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
              className={`flex w-full items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200 ${
                collapsed ? "h-9 justify-center" : "gap-2.5 px-2.5 py-2 text-xs md:text-sm font-medium"
              }`}
            >
              <Icon name={collapsed ? "chevronRight" : "chevronLeft"} className="h-4 w-4" />
              {!collapsed && "Recolher menu"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              clearToken();
              window.location.href = "/login";
            }}
            title={railOnly ? "Sair" : undefined}
            aria-label="Sair"
            className={`flex w-full items-center rounded-lg text-zinc-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300 ${
              railOnly ? "h-9 justify-center" : "gap-2.5 px-2.5 py-2 text-xs md:text-sm font-medium"
            }`}
          >
            <Icon name="logout" className="h-4 w-4" />
            {!railOnly && "Sair"}
          </button>
        </div>
      </aside>

      <main
        className={`flex min-w-0 flex-1 flex-col ${
          isInbox ? "min-h-0 overflow-hidden" : "overflow-auto"
        }`}
      >
        <div
          className={
            isInbox
              ? "flex min-h-0 w-full flex-1 flex-col"
              : "zap-enter mx-auto w-full max-w-6xl p-6 md:p-8"
          }
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
