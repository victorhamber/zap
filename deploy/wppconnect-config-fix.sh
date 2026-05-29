#!/bin/sh
# Rode DENTRO do container wppconnect (console EasyPanel), uma vez:
#   sh /caminho/wppconnect-config-fix.sh
# Ou copie/cole os comandos sed abaixo no config real do seu deploy.

set -e
CFG=""
for f in /usr/src/wpp-server/src/config.ts /usr/src/wpp-server/dist/config.js /usr/src/wpp-server/config.ts; do
  if [ -f "$f" ]; then CFG="$f"; break; fi
done

if [ -z "$CFG" ]; then
  echo "Arquivo config não encontrado. Rode: find /usr/src/wpp-server -name 'config.*'"
  exit 1
fi

echo "Editando: $CFG"
cp "$CFG" "${CFG}.bak.$(date +%s)"

# startAllSession: true -> false
sed -i 's/startAllSession: true/startAllSession: false/g' "$CFG" 2>/dev/null || true
sed -i 's/startAllSession:true/startAllSession: false/g' "$CFG" 2>/dev/null || true

# autoClose: 60000 ou 60 -> 0
sed -i 's/autoClose: 60000/autoClose: 0/g' "$CFG" 2>/dev/null || true
sed -i 's/autoClose: 60,/autoClose: 0,/g' "$CFG" 2>/dev/null || true
sed -i 's/autoClose: 60$/autoClose: 0/g' "$CFG" 2>/dev/null || true

grep -E "startAllSession|autoClose|webhook" "$CFG" | head -15
echo "Reinicie o serviço wppconnect no EasyPanel. No log não deve mais aparecer AggregateError ao subir."
