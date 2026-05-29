#!/bin/sh
# =============================================================================
# EMERGÊNCIA: apaga tokens/*.data.json e userDataDir no container wppconnect
# quando o patch ainda não foi aplicado e o painel Zap não consegue remover.
#
# Cole no console EasyPanel do wppconnect (aba Sh).
# Uso opcional: export MANTER_SESSAO=123   (não apaga 123.data.json)
# =============================================================================

cd /usr/src/wpp-server 2>/dev/null || cd /app 2>/dev/null || {
  echo "Pasta do WPP não encontrada"
  exit 1
}

KEEP="${MANTER_SESSAO:-}"
TOKENS="./tokens"
USERDATA="./userDataDir"

echo "cwd: $(pwd)"
echo "MANTER_SESSAO=${KEEP:-<nenhuma — apaga todas>}"
echo ""
echo "=== Antes ==="
ls -la "$TOKENS" 2>/dev/null || echo "(sem pasta tokens)"

for f in "$TOKENS"/*.data.json; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .data.json)
  if [ -n "$KEEP" ] && [ "$name" = "$KEEP" ]; then
    echo "Mantendo token: $name"
    continue
  fi
  echo "rm token: $f"
  rm -f "$f"
  if [ -d "$USERDATA/$name" ]; then
    echo "rm userDataDir: $USERDATA/$name"
    rm -rf "$USERDATA/$name"
  fi
done

echo ""
echo "=== Depois ==="
ls -la "$TOKENS" 2>/dev/null || echo "(vazio)"
echo ""
echo "Reinicie o wppconnect (Stop -> Start)."
echo "No Zap: atualize a lista de instâncias — órfãs devem ter sumido."
