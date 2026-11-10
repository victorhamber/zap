#!/usr/bin/env python3
"""Mapa compacto do repositório para IA (zero dependências, Python 3.8+).

Uso (na raiz do projeto):
  python ai-docs/tools/map_repo.py            # regenera ai-docs/MAP.md
  python ai-docs/tools/map_repo.py --check    # lista o que mudou desde o último --ack e quais docs revisar
  python ai-docs/tools/map_repo.py --ack      # marca docs como revisados (grava baseline)
  python ai-docs/tools/map_repo.py --budget   # estima tokens dos docs de contexto
  (--hook-post-edit / --hook-stop / --hook-start: usados pelos ganchos automáticos do Claude Code)
Opções: --root DIR
"""
import argparse, ast, fnmatch, hashlib, json, os, re, subprocess, sys
from datetime import date
from pathlib import Path

DOCS = "ai-docs"
IGNORE_DIRS = {".git", "node_modules", "vendor", "__pycache__", ".venv", "venv", "dist", "build",
               ".next", ".nuxt", "coverage", ".idea", ".vscode", ".cache", "target", ".claude", ".cursor", DOCS}
BINARY_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf", ".zip", ".gz", ".rar",
              ".7z", ".exe", ".dll", ".ex5", ".ex4", ".so", ".woff", ".woff2", ".ttf", ".eot", ".mp4",
              ".mp3", ".mov", ".lock", ".map", ".min.js", ".pyc", ".sqlite", ".db", ".bin", ".log"}
NOISE = {".gitignore", ".cursorignore", ".gitattributes", "CLAUDE.md", "copilot-instructions.md", "ai-docs.mdc", "GEMINI.md", "token-economy.mdc"}
MAX_BYTES = 400_000
MAX_SYMS = 12
SPLIT_AT = 30_000  # chars; acima disso o mapa é dividido por pasta de topo

BUDGET = {  # tokens (≈ chars/4) por tipo de doc
    "AGENTS.md": 1200, f"{DOCS}/STATE.md": 600, f"{DOCS}/ARCHITECTURE.md": 1500,
    f"{DOCS}/CONVENTIONS.md": 800, f"{DOCS}/DECISIONS.md": 1500, f"{DOCS}/modules/*": 900,
}


# ---------- listagem ----------
def list_files(root: Path):
    try:
        out = subprocess.run(["git", "-C", str(root), "ls-files", "-co", "--exclude-standard"],
                             capture_output=True, text=True, check=True).stdout.split("\n")
        files = [f for f in out if f]
    except Exception:
        files = []
        for dp, dn, fn in os.walk(root):
            dn[:] = [d for d in dn if d not in IGNORE_DIRS]
            files += [os.path.relpath(os.path.join(dp, f), root) for f in fn]
    res = []
    for f in files:
        f = f.replace("\\", "/")
        p = root / f
        if any(part in IGNORE_DIRS for part in Path(f).parts[:-1]):
            continue
        if Path(f).name in NOISE or not p.is_file() or p.suffix.lower() in BINARY_EXT or p.stat().st_size > MAX_BYTES:
            continue
        res.append(f)
    return sorted(res)


def read(p: Path):
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""


# ---------- símbolos ----------
def sym_py(src):
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return []
    out = []
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out.append(n.name + "()")
        elif isinstance(n, ast.ClassDef):
            ms = [m.name for m in n.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))
                  and not m.name.startswith("_")]
            out.append(n.name + ("{" + ",".join(ms[:6]) + "}" if ms else ""))
    return out


RE_JS = re.compile(r"^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+(\w+)|class\s+(\w+)|"
                   r"(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>)", re.M)


def sym_js(src):
    return [next(g for g in m.groups() if g) + ("()" if not m.group(2) else "") for m in RE_JS.finditer(src)]


PHP_PATTERNS = [
    (re.compile(r"^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+(\w+)", re.M), "{0}"),
    (re.compile(r"^\s*(?:(?:public|private|protected|static)\s+)*function\s+(\w+)", re.M), "{0}()"),
    (re.compile(r"add_(?:action|filter)\(\s*['\"]([\w\-/]+)['\"]"), "hook:{0}"),
    (re.compile(r"add_shortcode\(\s*['\"](\w+)"), "shortcode:{0}"),
    (re.compile(r"register_post_type\(\s*['\"](\w+)"), "cpt:{0}"),
    (re.compile(r"register_rest_route\(\s*['\"]([\w\-/]+)['\"]\s*,\s*['\"]([^'\"]+)"), "rest:{0}{1}"),
]


def sym_php(src):
    found = []
    for rx, fmt in PHP_PATTERNS:
        for m in rx.finditer(src):
            found.append((m.start(), fmt.format(*m.groups())))
    return [s for _, s in sorted(found)]


RE_MQL_FUNC = re.compile(r"^(?:int|void|double|bool|string|long|ulong|datetime|color|float|char|uchar|short|"
                         r"ushort|uint|[A-Z]\w*\s*\*?)\s+(\w+)\s*\([^;{]*\)\s*(?:const)?\s*\{?\s*$", re.M)
RE_MQL_TYPE = re.compile(r"^(?:class|struct|enum)\s+(\w+)", re.M)
RE_MQL_INPUT = re.compile(r"^\s*(?:input|sinput)\s+[\w:<>]+\s+(\w+)", re.M)


def sym_mql(src):
    out = [m.group(1) for m in RE_MQL_TYPE.finditer(src)]
    out += [m.group(1) + "()" for m in RE_MQL_FUNC.finditer(src)]
    n = len(RE_MQL_INPUT.findall(src))
    if n:
        out.append(f"inputs({n})")
    return out


EXTRACT = {".py": sym_py, ".js": sym_js, ".jsx": sym_js, ".ts": sym_js, ".tsx": sym_js, ".mjs": sym_js,
           ".php": sym_php, ".mq5": sym_mql, ".mqh": sym_mql, ".mq4": sym_mql}


def describe(src, ext):
    """Primeira linha útil de docstring/comentário de cabeçalho (≤80 chars)."""
    if ext == ".md":
        m = re.search(r"^#\s+(.+)$", src, re.M)
        return m.group(1)[:80] if m else ""
    head = src[:1500]
    if ext == ".py":
        try:
            d = ast.get_docstring(ast.parse(src))
            return (d or "").strip().split("\n")[0][:80]
        except SyntaxError:
            return ""
    for line in head.split("\n")[:25]:
        t = line.strip().lstrip("/*#! ").strip()
        if (line.strip().startswith(("//", "/*", "*", "#")) and len(t) > 8
                and not re.match(r"(?i)(copyright|license|<\?php|@|-{3,}|={3,}|plugin name)", t)):
            return t[:80]
    return ""


# ---------- stack / entradas ----------
def detect(root: Path, files):
    stack, entries = [], []
    names = {Path(f).name for f in files}
    if "package.json" in names:
        stack.append("node")
        try:
            pj = json.loads(read(root / "package.json"))
            if pj.get("scripts"):
                entries.append("npm scripts: " + ", ".join(list(pj["scripts"])[:8]))
            if pj.get("main"):
                entries.append(pj["main"])
        except Exception:
            pass
    if "composer.json" in names:
        stack.append("php/composer")
    if names & {"requirements.txt", "pyproject.toml", "setup.py"}:
        stack.append("python")
    if any(f.endswith((".mq5", ".mqh", ".mq4")) for f in files):
        stack.append("mql5")
    for f in files:
        ext = Path(f).suffix
        if ext == ".php" and "Plugin Name:" in read(root / f)[:3000]:
            stack.append("wordpress-plugin")
            entries.append(f)
        elif ext == ".mq5" and "OnInit" in read(root / f):
            entries.append(f)
        elif Path(f).name in {"main.py", "app.py", "manage.py", "index.js", "server.js", "index.ts"}:
            entries.append(f)
    return sorted(set(stack)), entries[:8]


# ---------- geração do mapa ----------
def build(root: Path):
    files = list_files(root)
    rows, total_lines = {}, 0
    for f in files:
        p = root / f
        src = read(p)
        n = src.count("\n") + 1 if src else 0
        total_lines += n
        ext = p.suffix.lower()
        syms = EXTRACT[ext](src) if ext in EXTRACT else []
        if len(syms) > MAX_SYMS:
            syms = syms[:MAX_SYMS] + [f"+{len(syms) - MAX_SYMS}"]
        d = describe(src, ext)
        line = f"- {Path(f).name} [{n}L]" + (f" {d}" if d else "") + (f" — {', '.join(syms)}" if syms else "")
        rows.setdefault(str(Path(f).parent).replace("\\", "/"), []).append(line)
    return files, rows, total_lines


def render(root, files, rows, total_lines):
    stack, entries = detect(root, files)
    head = [f"# MAP — {root.name} · {date.today()} · {len(files)} arquivos · {total_lines} linhas",
            "> Gerado por ai-docs/tools/map_repo.py — NÃO editar. Use isto em vez de ler o código inteiro: "
            "ache o arquivo/símbolo aqui e abra só o trecho.",
            f"Stack: {', '.join(stack) or 'n/d'}", f"Entradas: {'; '.join(entries) or 'n/d'}", ""]
    body = []
    for d in sorted(rows):
        body.append(f"## {d if d != '.' else '(raiz)'}/")
        body += rows[d] + [""]
    return head, body, rows


def write_map(root: Path):
    files, rows, total = build(root)
    head, body, rows = render(root, files, rows, total)
    out = root / DOCS
    out.mkdir(exist_ok=True)
    text = "\n".join(head + body)
    mapdir = out / "map"
    if len(text) <= SPLIT_AT:
        (out / "MAP.md").write_text(text, encoding="utf-8")
        if mapdir.exists():
            for old in mapdir.glob("*.md"):
                old.unlink()
        return len(files), len(text)
    mapdir.mkdir(exist_ok=True)
    groups = {}
    for d, lines in rows.items():
        top = d.split("/")[0] if d != "." else "_raiz"
        groups.setdefault(top, []).append((d, lines))
    idx = head + ["Mapa dividido por pasta (abra só a que precisa):"]
    for top, items in sorted(groups.items()):
        content = [f"# MAP/{top}", ""]
        for d, lines in sorted(items):
            content += [f"## {d if d != '.' else '(raiz)'}/"] + lines + [""]
        (mapdir / f"{top}.md").write_text("\n".join(content), encoding="utf-8")
        idx.append(f"- ai-docs/map/{top}.md — {sum(len(l) for _, l in items)} arquivos")
    (out / "MAP.md").write_text("\n".join(idx), encoding="utf-8")
    return len(files), len("\n".join(idx))


# ---------- baseline / check ----------
def sha(p: Path):
    return hashlib.sha1(p.read_bytes()).hexdigest()[:12]


def snapshot(root: Path):
    return {f: sha(root / f) for f in list_files(root)}


def ack(root: Path):
    (root / DOCS).mkdir(exist_ok=True)
    (root / DOCS / ".baseline.json").write_text(json.dumps(snapshot(root), indent=0), encoding="utf-8")


def module_sources(root: Path):
    res = {}
    for md in sorted((root / DOCS / "modules").glob("*.md")):
        if md.name.startswith("_"):
            continue
        m = re.search(r"^\**Fontes:?\**:?\s*(.+)$", read(md), re.M)
        res[md.name] = [g.strip().strip("`") for g in m.group(1).split(",")] if m else []
    return res


def _mt(p: Path):
    try:
        return p.stat().st_mtime
    except OSError:
        return 0.0


def analyze(root: Path):
    """Retorna dict com pendências. Um módulo está em dia se o .md dele é mais novo que as fontes alteradas."""
    bp = root / DOCS / ".baseline.json"
    if not bp.exists():
        return {"no_baseline": True}
    old, new = json.loads(bp.read_text(encoding="utf-8")), snapshot(root)
    changed = sorted(f for f in new if old.get(f) != new[f])
    removed = sorted(f for f in old if f not in new)
    if not changed and not removed:
        return {"clean": True, "changed": [], "removed": []}
    base_mt = _mt(bp)
    newest = max([_mt(root / f) for f in changed] + [base_mt])
    mods = module_sources(root)
    covered, review = set(), {}
    for mod, globs in mods.items():
        hit = [f for f in changed + removed if any(fnmatch.fnmatch(f, g) or f.startswith(g.rstrip("*")) for g in globs if g)]
        if not hit:
            continue
        covered.update(hit)
        need = max([_mt(root / f) for f in hit if f in new] + [base_mt])
        if _mt(root / DOCS / "modules" / mod) < need:
            review[mod] = hit
    orphan = [f for f in changed + removed if f not in covered]
    state_stale = _mt(root / DOCS / "STATE.md") < newest
    return {"clean": False, "changed": changed, "removed": removed, "review": review,
            "orphan": orphan, "state_stale": state_stale}


def pending_lines(a):
    out = []
    for mod, hit in a.get("review", {}).items():
        out.append(f"- Atualize ai-docs/modules/{mod} (mudou: {', '.join(hit[:6])}{' …' if len(hit) > 6 else ''})")
    if a.get("orphan"):
        o = a["orphan"]
        out.append(f"- Sem módulo: {', '.join(o[:8])}{' …' if len(o) > 8 else ''} → crie/estenda ai-docs/modules/*.md com `Fontes:` cobrindo esses arquivos")
    if a.get("state_stale"):
        out.append("- Reescreva ai-docs/STATE.md (feito / próximo / bloqueio, ≤5 linhas)")
    return out


def check(root: Path):
    a = analyze(root)
    if a.get("no_baseline"):
        print("Sem baseline. Rode init.py ou --ack depois de documentar.")
        return 1
    if a["clean"]:
        print("OK: docs em dia.")
        return 0
    lines = pending_lines(a)
    if not lines:
        ack(root)
        print("OK: docs em dia (baseline atualizado).")
        return 0
    print(f"{len(a['changed'])} alterados/novos, {len(a['removed'])} removidos desde o último baseline.")
    print("\n".join(lines))
    print("Ao terminar, rode --check de novo (o baseline se atualiza sozinho quando tudo estiver em dia).")
    return 1


def hook_post_edit(root: Path):
    """PostToolUse: regenera o MAP (custo 0 de IA)."""
    write_map(root)


def hook_stop(root: Path):
    """Stop: se há docs pendentes, bloqueia o fim do turno e diz o que atualizar."""
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except Exception:
        data = {}
    write_map(root)
    a = analyze(root)
    if a.get("no_baseline") or a.get("clean"):
        return
    lines = pending_lines(a)
    if not lines:
        ack(root)
        return
    if data.get("stop_hook_active"):  # evita loop infinito: na 2ª vez deixa terminar
        return
    msg = ("Documentação do projeto desatualizada. Antes de encerrar, atualize:\n" + "\n".join(lines)
           + "\nConfira o código real antes de escrever; não invente. Depois rode: python ai-docs/tools/map_repo.py --check")
    print(json.dumps({"decision": "block", "reason": msg}, ensure_ascii=False))


def hook_start(root: Path):
    """SessionStart: injeta orientação mínima + pendências."""
    if not (root / DOCS).exists():
        return
    write_map(root)
    msg = ["Projeto com ai-docs ativo. Leia AGENTS.md e ai-docs/STATE.md; use ai-docs/MAP.md em vez de explorar o código.",
           "Regra: toda mudança no projeto exige atualizar o módulo afetado e o STATE.md na mesma tarefa, sem esperar pedido."]
    a = analyze(root)
    if not a.get("no_baseline") and not a.get("clean"):
        lines = pending_lines(a)
        if lines:
            msg.append("Pendências de documentação de sessões anteriores:")
            msg += lines
    print("\n".join(msg))


def budget(root: Path):
    over = 0
    paths = [root / "AGENTS.md"] + sorted((root / DOCS).glob("*.md")) + sorted((root / DOCS / "modules").glob("*.md"))
    print(f"{'arquivo':45} {'tokens≈':>8}  limite")
    for p in paths:
        if not p.exists() or p.name.startswith("_"):
            continue
        rel = str(p.relative_to(root)).replace("\\", "/")
        t = len(read(p)) // 4
        lim = next((v for k, v in BUDGET.items() if fnmatch.fnmatch(rel, k)), None)
        flag = ""
        if rel == f"{DOCS}/MAP.md":
            lim = None
        if lim and t > lim:
            flag, over = "  ⚠ acima — enxugue/divida", over + 1
        print(f"{rel:45} {t:>8}  {lim or '-'}{flag}")
    return 1 if over else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--ack", action="store_true")
    ap.add_argument("--budget", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--hook-post-edit", action="store_true")
    ap.add_argument("--hook-stop", action="store_true")
    ap.add_argument("--hook-start", action="store_true")
    a = ap.parse_args()
    root = Path(a.root).resolve()
    if a.hook_post_edit:
        return hook_post_edit(root)
    if a.hook_stop:
        return hook_stop(root)
    if a.hook_start:
        return hook_start(root)
    if a.check:
        sys.exit(check(root))
    if a.budget:
        sys.exit(budget(root))
    if a.ack:
        ack(root)
        print("Baseline gravado.")
        return
    n, size = write_map(root)
    if not a.quiet:
        print(f"{DOCS}/MAP.md gerado: {n} arquivos, ~{size // 4} tokens.")


if __name__ == "__main__":
    main()
