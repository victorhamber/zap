import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { clearToken } from "../api/client";

const NAV_COLLAPSED_KEY = "zap-nav-collapsed";

const links = [
  { to: "/", label: "Dashboard", icon: "◉" },
  { to: "/flows", label: "Fluxos", icon: "⎇" },
  { to: "/whatsapp", label: "WhatsApp", icon: "◎" },
  { to: "/media", label: "Mídias", icon: "▣" },
  { to: "/settings", label: "Configurações", icon: "⚙" }
];

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

  useEffect(() => {
    try {
      localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  return (
    <div
      className={`flex bg-zinc-950 ${isInbox ? "h-screen overflow-hidden" : "min-h-screen"}`}
    >
      <aside
        className={`shrink-0 border-r border-zinc-800/80 bg-zinc-950/90 backdrop-blur flex flex-col transition-[width] duration-200 ${
          collapsed ? "w-[68px]" : "w-60"
        }`}
      >
        <div className={`border-b border-zinc-800/80 ${collapsed ? "p-3" : "p-5"}`}>
          <div className={`flex items-center ${collapsed ? "justify-center" : "gap-3"}`}>
            <div
              className={`flex items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/25 font-bold text-emerald-400 shrink-0 ${
                collapsed ? "h-11 w-11 text-xl" : "h-10 w-10 text-lg"
              }`}
            >
              Z
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-semibold text-white">Zap</div>
                <div className="text-xs text-zinc-500">Automação WhatsApp</div>
              </div>
            )}
          </div>
        </div>
        <nav className={`flex-1 space-y-1 ${collapsed ? "p-2" : "p-3"}`}>
          {links.map((l) => {
            const active =
              loc.pathname === l.to ||
              (l.to !== "/" && l.to !== "/whatsapp" && loc.pathname.startsWith(l.to)) ||
              (l.to === "/whatsapp" && loc.pathname.startsWith("/whatsapp"));
            return (
              <Link
                key={l.to}
                to={l.to}
                title={collapsed ? l.label : undefined}
                className={`flex items-center rounded-xl transition ${
                  collapsed
                    ? "justify-center min-h-[48px] w-full py-2"
                    : "gap-3 px-3 py-2.5 text-sm"
                } ${
                  active
                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 border border-transparent"
                }`}
              >
                <span
                  className={
                    collapsed
                      ? "text-[26px] leading-none select-none"
                      : "text-xl leading-none select-none shrink-0 w-7 text-center"
                  }
                  aria-hidden
                >
                  {l.icon}
                </span>
                {!collapsed && l.label}
              </Link>
            );
          })}
        </nav>
        <div className={`border-t border-zinc-800/80 ${collapsed ? "p-2" : "p-3"} space-y-1`}>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className={`w-full rounded-xl text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300 transition ${
              collapsed
                ? "flex min-h-[48px] items-center justify-center text-2xl font-semibold leading-none"
                : "px-3 py-2.5 text-left text-sm"
            }`}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? "»" : "« Recolher menu"}
          </button>
          <button
            type="button"
            onClick={() => {
              clearToken();
              window.location.href = "/login";
            }}
            className={`w-full rounded-xl text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300 transition ${
              collapsed
                ? "flex min-h-[48px] items-center justify-center text-xl leading-none"
                : "px-3 py-2.5 text-left text-sm"
            }`}
            title={collapsed ? "Sair" : undefined}
          >
            {collapsed ? "⎋" : "Sair"}
          </button>
        </div>
      </aside>
      <main
        className={`flex-1 min-w-0 flex flex-col ${
          isInbox ? "min-h-0 overflow-hidden" : "overflow-auto"
        }`}
      >
        <div
          className={
            isInbox
              ? "flex-1 min-h-0 flex flex-col w-full"
              : "p-6 md:p-8 max-w-6xl mx-auto w-full"
          }
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
