import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Button, Card, ErrorNotice, PageHeader, SearchInput } from "../components/ui";

type Group = { id: string; name: string };

export function Broadcast() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [emailCount, setEmailCount] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [emailOn, setEmailOn] = useState(false);
  const [subject, setSubject] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void api<{ ok: boolean; groups: Group[]; emailCount: number; error?: string }>("/api/broadcast/targets")
      .then((r) => {
        setGroups(r.groups ?? []);
        setEmailCount(r.emailCount ?? 0);
        if (r.error) setError(r.error);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível carregar os grupos."))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q) || g.id.includes(q));
  }, [groups, query]);

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleVisible() {
    const ids = visible.map((g) => g.id);
    const allOn = ids.every((id) => picked.includes(id));
    setPicked((prev) => {
      if (allOn) return prev.filter((id) => !ids.includes(id));
      return [...new Set([...prev, ...ids])];
    });
  }

  async function send() {
    setSending(true);
    setError("");
    setNotice("");
    try {
      const r = await api<{ ok: boolean; groups: number; emails: number }>("/api/broadcast", {
        method: "POST",
        body: JSON.stringify({
          text,
          groupIds: picked,
          email: emailOn,
          subject
        })
      });
      const parts = [];
      if (r.groups > 0) parts.push(`${r.groups} grupo(s) — o primeiro sai agora, os outros com pausa diferente`);
      if (r.emails > 0) parts.push(`${r.emails} e-mail(s), cada um com uma pausa diferente`);
      setNotice(parts.join(". ") + ".");
      setText("");
      setPicked([]);
      setSubject("");
      setEmailOn(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível disparar.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Broadcast"
        subtitle="Disparo na hora para os grupos que você marcar. A pausa entre um e outro é sorteada, nunca a mesma."
      />
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {notice && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="space-y-3 p-4">
          <label className="block text-sm text-zinc-300">
            Mensagem
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="O texto que sai no grupo e, se você marcar, no e-mail."
              className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={emailOn}
              onChange={(e) => setEmailOn(e.target.checked)}
              className="mt-1"
            />
            <span>
              Também enviar por e-mail para os contatos que têm endereço ({emailCount}). Quem cancelou não recebe.
              Cada envio espera uma pausa diferente, entre 15 e 45 segundos.
            </span>
          </label>
          {emailOn && (
            <label className="block text-sm text-zinc-300">
              Assunto do e-mail
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
                placeholder="Assunto"
              />
            </label>
          )}
          <Button variant="primary" disabled={sending || !text.trim()} onClick={() => void send()}>
            {sending ? "Disparando…" : "Disparar agora"}
          </Button>
          <p className="text-xs text-zinc-500">
            O primeiro grupo sai na hora. Os seguintes esperam entre 25 e 70 segundos, um tempo novo a cada grupo.
          </p>
        </Card>
        <Card className="flex max-h-[70vh] flex-col overflow-hidden p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm text-zinc-200">Grupos ({picked.length})</p>
            <button type="button" className="text-xs text-emerald-400" onClick={toggleVisible}>
              Marcar visíveis
            </button>
          </div>
          <SearchInput value={query} onChange={setQuery} placeholder="Buscar grupo" className="mb-3" />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {loading && <p className="text-sm text-zinc-500">Carregando grupos…</p>}
            {!loading && visible.length === 0 && (
              <p className="text-sm text-zinc-500">Nenhum grupo encontrado.</p>
            )}
            {visible.map((g) => (
              <label key={g.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-1.5 hover:bg-zinc-900">
                <input
                  type="checkbox"
                  checked={picked.includes(g.id)}
                  onChange={() => toggle(g.id)}
                  className="mt-1"
                />
                <span className="text-sm text-zinc-100">{g.name}</span>
              </label>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
