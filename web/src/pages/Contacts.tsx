import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Badge, Button, Card, ErrorNotice, PageHeader, SearchInput } from "../components/ui";

type Tag = { id: string; name: string; color: string };
type ContactRow = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  notes?: string | null;
  stage: string | null;
  lostReason?: string | null;
  productName: string | null;
  tags: Tag[];
};

const PAGE_SIZE = 20;

const STAGE: Record<string, string> = {
  novo: "Novo",
  em_conversa: "Em conversa",
  comprou: "Comprou",
  perdido: "Perdido"
};

const LOST: Record<string, string> = {
  preco: "Preço",
  sumiu: "Sumiu",
  ja_tem: "Já tem",
  outro: "Outro"
};

function phoneLabel(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? `+${digits}` : phone;
}

export function Contacts() {
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftStage, setDraftStage] = useState("novo");
  const [draftLost, setDraftLost] = useState("sumiu");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void api<{ ok: boolean; contacts: ContactRow[] }>("/api/contacts")
      .then((r) => setRows(r.contacts ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível listar os contatos."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => {
      const blob = [c.name, c.phone, c.email, c.productName, ...c.tags.map((t) => t.name)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [rows, query]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = visible.slice(start, start + PAGE_SIZE);

  function openEdit(c: ContactRow) {
    setEditingId(c.id);
    setDraftName(c.name ?? "");
    setDraftEmail(c.email ?? "");
    setDraftNotes(c.notes ?? "");
    setDraftStage(c.stage && STAGE[c.stage] ? c.stage : "novo");
    setDraftLost(c.lostReason && LOST[c.lostReason] ? c.lostReason : "sumiu");
    setError("");
  }

  async function saveEdit(c: ContactRow) {
    if (draftStage === "perdido" && !LOST[draftLost]) {
      setError("Escolha o motivo de perdido.");
      return;
    }
    setBusyId(c.id);
    setError("");
    try {
      const r = await api<{ ok: boolean; contact: ContactRow | null }>(
        `/api/contacts/${encodeURIComponent(c.phone)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            name: draftName.trim(),
            email: draftEmail.trim(),
            notes: draftNotes.trim(),
            stage: draftStage,
            ...(draftStage === "perdido" ? { lostReason: draftLost } : {})
          })
        }
      );
      if (!r.contact) throw new Error("Não foi possível gravar o contato.");
      setRows((prev) => prev.map((row) => (row.id === c.id ? { ...row, ...r.contact } : row)));
      setEditingId(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(c: ContactRow) {
    const who = c.name?.trim() || phoneLabel(c.phone);
    if (
      !window.confirm(
        `Excluir ${who}? Some da lista, apaga as mensagens deste número no Zap e as etiquetas.`
      )
    ) {
      return;
    }
    setBusyId(c.id);
    setError("");
    try {
      await api(`/api/contacts/${encodeURIComponent(c.phone)}/crm`, { method: "DELETE" });
      setRows((prev) => prev.filter((row) => row.id !== c.id));
      if (editingId === c.id) setEditingId(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível excluir.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contatos"
        subtitle="Quem já foi gravado no Zap: conversa, compra, etiqueta ou cadastro."
        actions={
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Buscar nome, telefone ou etiqueta"
            className="w-full sm:w-72"
          />
        }
      />
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Card className="overflow-hidden">
        {loading && <p className="p-4 text-sm text-zinc-400">Carregando contatos…</p>}
        {!loading && visible.length === 0 && (
          <p className="p-4 text-sm text-zinc-400">
            {rows.length === 0 ? "Nenhum contato coletado ainda." : "Nenhum contato com essa busca."}
          </p>
        )}
        {!loading && slice.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">E-mail</th>
                  <th className="px-4 py-3 font-medium">Telefone</th>
                  <th className="px-4 py-3 font-medium">Etiquetas</th>
                  <th className="px-4 py-3 font-medium">Etapa</th>
                  <th className="px-4 py-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((c) => (
                  <tr key={c.id} className="border-b border-zinc-800/80 align-top">
                    <td className="px-4 py-3 text-zinc-100">
                      {editingId === c.id ? (
                        <input
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                          placeholder="Nome"
                        />
                      ) : (
                        c.name?.trim() || "Sem nome"
                      )}
                      {c.productName && editingId !== c.id && (
                        <p className="text-xs text-zinc-500">{c.productName}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {editingId === c.id ? (
                        <input
                          value={draftEmail}
                          onChange={(e) => setDraftEmail(e.target.value)}
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                          placeholder="email@exemplo.com"
                        />
                      ) : (
                        c.email || "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{phoneLabel(c.phone)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.length === 0 && <span className="text-zinc-500">—</span>}
                        {c.tags.map((t) => (
                          <Badge key={t.id} tone="neutral">
                            {t.name}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {editingId === c.id ? (
                        <div className="space-y-2">
                          <select
                            value={draftStage}
                            onChange={(e) => setDraftStage(e.target.value)}
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                          >
                            {Object.entries(STAGE).map(([id, label]) => (
                              <option key={id} value={id}>
                                {label}
                              </option>
                            ))}
                          </select>
                          {draftStage === "perdido" && (
                            <select
                              value={draftLost}
                              onChange={(e) => setDraftLost(e.target.value)}
                              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                            >
                              {Object.entries(LOST).map(([id, label]) => (
                                <option key={id} value={id}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          )}
                          <textarea
                            value={draftNotes}
                            onChange={(e) => setDraftNotes(e.target.value)}
                            rows={2}
                            placeholder="Observações"
                            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
                          />
                        </div>
                      ) : (
                        <Badge tone="neutral">{STAGE[c.stage ?? ""] ?? "Novo"}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {editingId === c.id ? (
                          <>
                            <Button size="sm" variant="primary" disabled={busyId === c.id} onClick={() => void saveEdit(c)}>
                              Salvar
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" icon="pencil" aria-label="Editar" title="Editar" onClick={() => openEdit(c)} />
                            <Button
                              size="sm"
                              variant="ghost"
                              icon="trash"
                              aria-label="Excluir"
                              title="Excluir"
                              disabled={busyId === c.id}
                              onClick={() => void remove(c)}
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && visible.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3 text-sm text-zinc-400">
            <p>
              {start + 1}–{start + slice.length} de {visible.length}
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                Anterior
              </Button>
              <span>
                {safePage} / {pageCount}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={safePage >= pageCount}
                onClick={() => setPage(safePage + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
