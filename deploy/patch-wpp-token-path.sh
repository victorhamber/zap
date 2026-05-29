#!/bin/sh
# Corrige bug do WPPConnect: clear-session-data / logout não apagam tokens/*.data.json
# (path errado com __dirname). Sem isso, show-all-sessions lista sessões "fantasma".
#
# Uso: dentro do container wppconnect, cwd /usr/src/wpp-server (ou raiz do app).

set -e
ROOT="${1:-.}"
cd "$ROOT" || exit 1

echo "=== Patch token path (miscController + sessionController) ==="

patched=0
find . \( -name 'miscController.js' -o -name 'sessionController.js' \) 2>/dev/null | while read -r f; do
  [ -f "$f" ] || continue
  if ! grep -q '__dirname.*tokens/' "$f" 2>/dev/null; then
    continue
  fi
  echo "  -> $f"
  cp "$f" "${f}.bak.zap.$(date +%s)"
  sed -i 's|__dirname + `../../../tokens/${session}.data.json`|require("path").join(process.cwd(), "tokens", `${session}.data.json`)|g' "$f"
  sed -i 's|__dirname + `../../../tokens/${req.session}.data.json`|require("path").join(process.cwd(), "tokens", `${req.session}.data.json`)|g' "$f"
  sed -i 's|__dirname + `../../../tokens/${req.params.session}.data.json`|require("path").join(process.cwd(), "tokens", `${req.params.session}.data.json`)|g' "$f"
  patched=1
done

if [ "$patched" = "1" ]; then
  echo "Patch aplicado. Reinicie o wppconnect e teste Remover / Limpar órfãs no Zap."
else
  echo "Nenhum arquivo com path antigo encontrado (imagem já corrigida ou layout diferente)."
fi
