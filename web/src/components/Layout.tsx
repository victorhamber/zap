import { Link, Outlet, useLocation } from "react-router-dom";
import { clearToken } from "../api/client";

const links = [
  { to: "/", label: "Dashboard" },
  { to: "/flows", label: "Fluxos" },
  { to: "/settings", label: "Configurações" }
];

export function Layout() {
  const loc = useLocation();

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-zinc-800 bg-zinc-950/80 p-4 flex flex-col">
        <div className="text-lg font-semibold">Zap</div>
        <div className="text-xs text-zinc-500 mb-6">Automação WhatsApp</div>
        <nav className="space-y-1 flex-1">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`block rounded-lg px-3 py-2 text-sm ${
                loc.pathname === l.to || (l.to !== "/" && loc.pathname.startsWith(l.to))
                  ? "bg-emerald-400/10 text-emerald-300"
                  : "text-zinc-300 hover:bg-zinc-900"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => {
            clearToken();
            window.location.href = "/login";
          }}
          className="text-sm text-zinc-500 hover:text-zinc-300 text-left px-3 py-2"
        >
          Sair
        </button>
      </aside>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
