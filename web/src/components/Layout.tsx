import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { clearToken } from "../api/client";
import { Icon, type IconName } from "./ui";

const NAV_COLLAPSED_KEY = "zap-nav-collapsed";

const links: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/flows", label: "Fluxos", icon: "flow" },
  { to: "/whatsapp", label: "WhatsApp", icon: "chat" },
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
        className={`flex shrink-0 flex-col border-r border-[var(--line)] bg-[var(--surface-1)]/80 backdrop-blur-xl transition-[width] duration-200 ease-out ${
          railOnly ? "w-[76px]" : "w-64"
        }`}
      >
        {/* Marca */}
        <div className={`border-b border-[var(--line)] ${railOnly ? "px-3 py-4" : "px-5 py-5"}`}>
          <Link
            to="/"
            className={`flex items-center rounded-xl ${railOnly ? "justify-center" : "gap-3"}`}
            title="Zap — Automação WhatsApp"
          >
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-lg font-bold text-zinc-950 shadow-lg shadow-emerald-500/20">
              Z
            </span>
            {!railOnly && (
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold leading-tight text-white">Zap</span>
                <span className="block text-[11px] leading-tight text-zinc-500">
                  Automação WhatsApp
                </span>
              </span>
            )}
          </Link>
        </div>

        {/* Navegação */}
        <nav className={`flex-1 space-y-1 ${railOnly ? "px-2.5 py-3" : "px-3 py-4"}`}>
          {!railOnly && (
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">
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
                className={`group relative flex items-center rounded-xl transition duration-150 ${
                  railOnly ? "h-11 justify-center" : "gap-3 px-3 py-2.5 text-sm font-medium"
                } ${
                  active
                    ? "bg-brand-500/10 text-brand-300"
                    : "text-zinc-400 hover:bg-[var(--surface-2)] hover:text-zinc-100"
                }`}
              >
                {/* marcador da rota ativa */}
                <span
                  className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-400 transition-opacity ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                />
                <Icon name={l.icon} className={railOnly ? "h-[22px] w-[22px]" : "h-[18px] w-[18px]"} />
                {!railOnly && l.label}
              </Link>
            );
          })}
        </nav>

        {/* Rodapé */}
        <div className={`space-y-1 border-t border-[var(--line)] ${railOnly ? "p-2.5" : "p-3"}`}>
          {/* em tela estreita a barra já fica fixa em modo ícone — o botão só confundiria */}
          {!narrow && (
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? "Expandir menu" : "Recolher menu"}
              aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
              className={`flex w-full items-center rounded-xl text-zinc-500 transition hover:bg-[var(--surface-2)] hover:text-zinc-300 ${
                collapsed ? "h-11 justify-center" : "gap-3 px-3 py-2.5 text-sm"
              }`}
            >
              <Icon name={collapsed ? "chevronRight" : "chevronLeft"} className="h-[18px] w-[18px]" />
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
            className={`flex w-full items-center rounded-xl text-zinc-500 transition hover:bg-red-500/10 hover:text-red-300 ${
              railOnly ? "h-11 justify-center" : "gap-3 px-3 py-2.5 text-sm"
            }`}
          >
            <Icon name="logout" className="h-[18px] w-[18px]" />
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
