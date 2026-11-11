import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Badge, Card, ErrorNotice, PageHeader, SearchInput } from "../components/ui";

type Tag = { id: string; name: string; color: string };
type ContactRow = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  stage: string | null;
  productName: string | null;
  tags: Tag[];
};

const STAGE: Record<string, string> = {
  novo: "Novo",
  em_conversa: "Em conversa",
  comprou: "Comprou",
  perdido: "Perdido"
};

export function Contacts() {
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api<{ ok: boolean; contacts: ContactRow[] }>("/api/contacts")
      .then((r) => setRows(r.contacts ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível listar os contatos."))
      .finally(() => setLoading(false));
  }, []);

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
        {!loading && visible.length > 0 && (
          <ul className="divide-y divide-zinc-800">
            {visible.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-zinc-100">{c.name?.trim() || "Sem nome"}</p>
                  <p className="text-sm text-zinc-400">{c.phone}</p>
                  {c.email && <p className="text-xs text-zinc-500">{c.email}</p>}
                  {c.productName && <p className="text-xs text-zinc-500">{c.productName}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral">{STAGE[c.stage ?? ""] ?? c.stage ?? "Novo"}</Badge>
                  {c.tags.map((t) => (
                    <Badge key={t.id} tone="neutral">
                      {t.name}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
