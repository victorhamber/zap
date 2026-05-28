import { Link, Outlet, useLocation } from "react-router-dom";
import { clearToken } from "../api/client";

const links = [
  { to: "/", label: "Dashboard", icon: "◉" },
  { to: "/flows", label: "Fluxos", icon: "⎇" },
  { to: "/settings", label: "Configurações", icon: "⚙" }
];

export function Layout() {
  const loc = useLocation();

  return (
    <div className="min-h-screen flex bg-zinc-950">
      <aside className="w-60 shrink-0 border-r border-zinc-800/80 bg-zinc-950/90 backdrop-blur flex flex-col">
        <div className="p-5 border-b border-zinc-800/80">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-lg font-bold text-emerald-400">
              Z
            </div>
            <div>
              <div className="font-semibold text-white">Zap</div>
              <div className="text-xs text-zinc-500">Automação WhatsApp</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {links.map((l) => {
            const active =
              loc.pathname === l.to || (l.to !== "/" && loc.pathname.startsWith(l.to));
            return (
              <Link
                key={l.to}
                to={l.to}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition ${
                  active
                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 border border-transparent"
                }`}
              >
                <span className="text-xs opacity-70">{l.icon}</span>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-zinc-800/80">
          <button
            type="button"
            onClick={() => {
              clearToken();
              window.location.href = "/login";
            }}
            className="w-full rounded-xl px-3 py-2.5 text-sm text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300 text-left transition"
          >
            Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-auto">
        <div className="p-6 md:p-8 max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
