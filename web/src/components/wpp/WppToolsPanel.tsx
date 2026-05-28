import { useState } from "react";
import { api } from "../../api/client";

const QUICK_ACTIONS = [
  { id: "groups", label: "Listar grupos", path: "/all-groups", method: "GET" as const },
  { id: "chats", label: "Listar chats", path: "/all-chats", method: "GET" as const },
  { id: "contacts", label: "Listar contatos", path: "/all-contacts", method: "GET" as const },
  { id: "connection", label: "Verificar conexão", path: "/check-connection-session", method: "GET" as const }
];

export function WppToolsPanel() {
  const [customPath, setCustomPath] = useState("/all-groups");
  const [customMethod, setCustomMethod] = useState<"GET" | "POST">("GET");
  const [customBody, setCustomBody] = useState('{\n  "phone": "5511999999999",\n  "message": "Teste",\n  "isGroup": false\n}');
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [groupMsg, setGroupMsg] = useState("");

  async function call(path: string, method: "GET" | "POST", payload?: unknown) {
    setLoading(true);
    setResult("Carregando…");
    try {
      const r = await api<{ ok: boolean; data?: unknown; error?: string }>("/api/wpp/call", {
        method: "POST",
        body: JSON.stringify({ path, method, payload })
      });
      if (!r.ok) throw new Error(r.error ?? "Erro");
      setResult(JSON.stringify(r.data, null, 2));
    } catch (e: any) {
      setResult(e?.message ?? "Erro na chamada");
    } finally {
      setLoading(false);
    }
  }

  async function sendGroupMessage() {
    if (!groupId.trim()) return;
    await call("/send-message", "POST", {
      phone: groupId.trim(),
      message: groupMsg,
      isGroup: true
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Ferramentas WPPConnect</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Ações da API na instância ativa — grupos, chats, envios e mais.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={loading}
            onClick={() => call(a.path, a.method)}
            className="rounded-xl border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-900 disabled:opacity-50"
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <h3 className="text-sm font-medium text-zinc-300">Mensagem em grupo</h3>
        <input
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          placeholder="ID do grupo (ex: 120363...@g.us)"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-mono"
        />
        <textarea
          value={groupMsg}
          onChange={(e) => setGroupMsg(e.target.value)}
          rows={2}
          placeholder="Mensagem"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={loading}
          onClick={sendGroupMessage}
          className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-zinc-950"
        >
          Enviar no grupo
        </button>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <h3 className="text-sm font-medium text-zinc-300">Chamada personalizada</h3>
        <div className="flex gap-2">
          <select
            value={customMethod}
            onChange={(e) => setCustomMethod(e.target.value as "GET" | "POST")}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
          <input
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-mono"
            placeholder="/all-groups"
          />
        </div>
        {customMethod === "POST" && (
          <textarea
            value={customBody}
            onChange={(e) => setCustomBody(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono"
          />
        )}
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            let payload: unknown;
            if (customMethod === "POST") {
              try {
                payload = JSON.parse(customBody);
              } catch {
                setResult("JSON inválido no corpo");
                return;
              }
            }
            call(customPath, customMethod, payload);
          }}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
        >
          Executar
        </button>
      </div>

      {result && (
        <pre className="max-h-80 overflow-auto rounded-xl border border-zinc-800 bg-black/40 p-3 text-xs text-zinc-300">
          {result}
        </pre>
      )}
    </div>
  );
}
