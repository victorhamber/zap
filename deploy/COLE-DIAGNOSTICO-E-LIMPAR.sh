#!/bin/sh
# Cole no console wppconnect APÓS o patch Node.
# 1) Confirma patch no disco  2) Apaga tokens órfãos  3) Lembra de REINICIAR
cd /usr/src/wpp-server 2>/dev/null || cd /app 2>/dev/null || exit 1

KEEP="${MANTER_SESSAO:-454}"
echo "cwd: $(pwd)"
echo "MANTER_SESSAO=${KEEP} (export MANTER_SESSAO= para apagar todas)"
echo ""

echo "=== 1) Patch no disco? ==="
if grep -q "__dirname.*tokens" ./dist/controller/miscController.js 2>/dev/null; then
  echo "ERRO: miscController ainda com __dirname — rode deploy/COLE-PATCH-TOKENS-IBSDDEV.sh"
  grep -n "__dirname.*tokens" ./dist/controller/miscController.js | head -3
  exit 1
fi
grep -n "resolve(process.cwd(), 'tokens'" ./dist/controller/miscController.js | head -2
echo "OK: miscController patcheado"
echo ""

echo "=== 2) Tokens antes ==="
ls -la ./tokens/*.data.json 2>/dev/null || echo "(nenhum .data.json)"
echo ""

echo "=== 3) Apagar tokens (exceto MANTER_SESSAO) ==="
for f in ./tokens/*.data.json; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .data.json)
  if [ -n "$KEEP" ] && [ "$name" = "$KEEP" ]; then
    echo "mantém: $name"
    continue
  fi
  echo "rm: $f"
  rm -f "$f"
  [ -d "./userDataDir/$name" ] && rm -rf "./userDataDir/$name"
done
echo ""
echo "=== 4) Tokens depois ==="
ls -la ./tokens/*.data.json 2>/dev/null || echo "(nenhum)"
echo ""
echo "=== OBRIGATÓRIO ==="
echo "Reinicie o wppconnect (Stop -> Start). Sem restart o Node usa código ANTIGO na RAM."
echo "Depois no Zap: atualize a lista — órfãs devem sumir do WPP."
echo "Remover no painel só funciona com patch + restart; esta limpeza é emergência."
