#!/bin/sh
# Cole ESTE BLOCO INTEIRO no console EasyPanel do serviço wppconnect (aba Console / Sh).
# Não cole createOptions:{...} linha a linha — isso não é shell.

set -e
cd /usr/src/wpp-server || exit 1

echo "=== Arquivos config encontrados ==="
find . -maxdepth 3 \( -name 'config.ts' -o -name 'config.js' \) 2>/dev/null

patch_file() {
  f="$1"
  [ -f "$f" ] || return 0
  echo "=== Patch: $f ==="
  cp "$f" "${f}.bak.$(date +%s)"
  sed -i 's/startAllSession: true/startAllSession: false/g' "$f" 2>/dev/null || true
  sed -i 's/startAllSession:true/startAllSession: false/g' "$f" 2>/dev/null || true
  sed -i 's/autoClose: 60000/autoClose: 0/g' "$f" 2>/dev/null || true
  sed -i 's/autoClose: 60,/autoClose: 0,/g' "$f" 2>/dev/null || true
  grep -E "startAllSession|autoClose" "$f" | head -5
}

# O Node usa dist/ em produção — patch nos dois
patch_file "./dist/config.js"
patch_file "./src/config.ts"

echo ""
echo ""
echo "=== Variáveis EasyPanel (serviço wppconnect) ==="
echo "WPP_START_ALL_SESSION=false"
echo "WPP_AUTO_CLOSE=0"
echo ""
echo "=== PRONTO ==="
echo "1) Reinicie o wppconnect no EasyPanel (Stop -> Start, 1 réplica)"
echo "2) Log NÃO deve mostrar AggregateError em startAllSessions nem Auto close 60s"
echo "3) No Zap: Conectar / Mostrar QR (só quando você clicar)"
