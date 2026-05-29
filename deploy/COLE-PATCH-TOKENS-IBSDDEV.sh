#!/bin/sh
# Só o patch de tokens para imagem ibsddev (aspas simples). Cole no console wppconnect.
cd /usr/src/wpp-server || cd /app || exit 1

for f in ./dist/controller/miscController.js ./dist/controller/sessionController.js; do
  [ -f "$f" ] || continue
  echo "  -> $f"
  cp "$f" "${f}.bak.fix.$(date +%s)"
  sed -i "s|__dirname + '../../../tokens/\${session}.data.json'|require('path').resolve(process.cwd(), 'tokens', session + '.data.json')|g" "$f"
  sed -i "s|__dirname + '../../../tokens/\${req.session}.data.json'|require('path').resolve(process.cwd(), 'tokens', req.session + '.data.json')|g" "$f"
  sed -i "s|__dirname + '../../../tokens/\${req.params.session}.data.json'|require('path').resolve(process.cwd(), 'tokens', req.params.session + '.data.json')|g" "$f"
done

echo ""
if grep '__dirname.*tokens' ./dist/controller/miscController.js ./dist/controller/sessionController.js 2>/dev/null | grep -q .; then
  echo "ERRO: ainda há __dirname + tokens:"
  grep -n '__dirname.*tokens' ./dist/controller/miscController.js ./dist/controller/sessionController.js
  exit 1
fi
echo "OK. Reinicie o wppconnect e teste Remover / Limpar órfãs no Zap."
