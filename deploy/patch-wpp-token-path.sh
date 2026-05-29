#!/bin/sh
# Corrige bug do WPPConnect 2.x: clear-session-data não apaga tokens/*.data.json
# (path errado com __dirname). Sem isso, show-all-sessions lista sessões fantasma.
#
# Uso: sh patch-wpp-token-path.sh [/usr/src/wpp-server]

set -e
ROOT="${1:-.}"
cd "$ROOT" || exit 1

echo "=== Patch token path (miscController + sessionController) ==="
echo "    cwd: $(pwd)"

patch_one_file() {
  f="$1"
  [ -f "$f" ] || return 0
  if ! grep -q '__dirname' "$f" 2>/dev/null || ! grep -q 'tokens/' "$f" 2>/dev/null; then
    return 0
  fi
  if ! grep -q '__dirname.*tokens/' "$f" 2>/dev/null; then
    return 0
  fi

  echo "  -> $f"
  cp "$f" "${f}.bak.zap.$(date +%s)"

  # Template literals (src ou dist ES2015+)
  sed -i 's|__dirname + `../../../tokens/${session}.data.json`|require("path").resolve(process.cwd(), "tokens", session + ".data.json")|g' "$f"
  sed -i 's|__dirname + `../../../tokens/${req.session}.data.json`|require("path").resolve(process.cwd(), "tokens", req.session + ".data.json")|g' "$f"
  sed -i 's|__dirname + `../../../tokens/${req.params.session}.data.json`|require("path").resolve(process.cwd(), "tokens", req.params.session + ".data.json")|g' "$f"

  # JS compilado (concatenação com +)
  sed -i 's|__dirname + "../../../tokens/" + session + ".data.json"|require("path").resolve(process.cwd(), "tokens", session + ".data.json")|g' "$f"
  sed -i 's|__dirname + "../../../tokens/" + req.session + ".data.json"|require("path").resolve(process.cwd(), "tokens", req.session + ".data.json")|g' "$f"
  sed -i 's|__dirname + "../../../tokens/" + req.params.session + ".data.json"|require("path").resolve(process.cwd(), "tokens", req.params.session + ".data.json")|g' "$f"
  sed -i "s|__dirname + '../../../tokens/' + session + '.data.json'|require('path').resolve(process.cwd(), 'tokens', session + '.data.json')|g" "$f"
  sed -i "s|__dirname + '../../../tokens/' + req.session + '.data.json'|require('path').resolve(process.cwd(), 'tokens', req.session + '.data.json')|g" "$f"
  sed -i "s|__dirname + '../../../tokens/' + req.params.session + '.data.json'|require('path').resolve(process.cwd(), 'tokens', req.params.session + '.data.json')|g" "$f"

  # Patches antigos (join) → resolve
  sed -i 's|require("path").join(process.cwd(), "tokens", `${session}.data.json`)|require("path").resolve(process.cwd(), "tokens", session + ".data.json")|g' "$f"
  sed -i 's|require("path").join(process.cwd(), "tokens", `${req.session}.data.json`)|require("path").resolve(process.cwd(), "tokens", req.session + ".data.json")|g' "$f"
  sed -i 's|require("path").join(process.cwd(), "tokens", `${req.params.session}.data.json`)|require("path").resolve(process.cwd(), "tokens", req.params.session + ".data.json")|g' "$f"
}

patched_any=0
for f in $(find . \( -path './node_modules/*' -o -path './.git/*' \) -prune -o \
  \( -name 'miscController.js' -o -name 'sessionController.js' \) -print 2>/dev/null); do
  before=$(grep -c '__dirname.*tokens/' "$f" 2>/dev/null || echo 0)
  patch_one_file "$f"
  after=$(grep -c '__dirname.*tokens/' "$f" 2>/dev/null || echo 0)
  if [ "$before" != "$after" ] 2>/dev/null; then
    patched_any=1
  elif ! grep -q '__dirname.*tokens/' "$f" 2>/dev/null && [ "$before" -gt 0 ] 2>/dev/null; then
    patched_any=1
  fi
done

echo ""
if grep -rq '__dirname.*tokens/' ./dist/controller 2>/dev/null || \
   grep -rq '__dirname.*tokens/' ./src/controller 2>/dev/null; then
  echo "AVISO: ainda há path antigo (__dirname + tokens). Mostrando trechos:"
  grep -rn '__dirname.*tokens/' ./dist/controller ./src/controller 2>/dev/null | head -8 || true
  echo "Envie essas linhas ao suporte Zap ou use deploy/APAGAR-TOKENS-MANUAL.sh"
  exit 1
fi

if [ "$patched_any" = "1" ]; then
  echo "OK: patch aplicado. Reinicie o wppconnect e teste Remover / Limpar órfãs no Zap."
else
  echo "Nenhum arquivo com path antigo encontrado (imagem já corrigida ou layout diferente)."
fi
