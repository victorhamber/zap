#!/bin/sh
# =============================================================================
# COLE ESTE ARQUIVO INTEIRO no console EasyPanel do serviço wppconnect (aba Sh).
# NÃO digite: deploy/wppconnect-config-fix.sh  (esse caminho não existe no container)
# Selecione tudo abaixo, copie e cole no terminal; Enter no final.
# =============================================================================

cd /usr/src/wpp-server || cd /app || { echo "Pasta do WPP não encontrada"; exit 1; }

echo "=== 1) Patch config (startAllSession + autoClose) ==="
for f in ./dist/config.js ./src/config.ts; do
  [ -f "$f" ] || continue
  echo "  -> $f"
  cp "$f" "${f}.bak.$(date +%s)"
  sed -i 's/startAllSession: true/startAllSession: false/g' "$f" 2>/dev/null || true
  sed -i 's/startAllSession:true/startAllSession: false/g' "$f" 2>/dev/null || true
  sed -i 's/autoClose: 60000/autoClose: 0/g' "$f" 2>/dev/null || true
  sed -i 's/autoClose: 60,/autoClose: 0,/g' "$f" 2>/dev/null || true
done

echo ""
echo "=== 2) Patch token path (excluir sessão no painel Zap) ==="

patch_one_file() {
  f="$1"
  [ -f "$f" ] || return 0
  grep -q '__dirname.*tokens/' "$f" 2>/dev/null || return 0
  echo "  -> $f"
  cp "$f" "${f}.bak.zap.$(date +%s)"
  # ibsddev/wppconnect-server: aspas simples — '${session}' é literal, não template
  sed -i "s|__dirname + '../../../tokens/\${session}.data.json'|require('path').resolve(process.cwd(), 'tokens', session + '.data.json')|g" "$f"
  sed -i "s|__dirname + '../../../tokens/\${req.session}.data.json'|require('path').resolve(process.cwd(), 'tokens', req.session + '.data.json')|g" "$f"
  sed -i "s|__dirname + '../../../tokens/\${req.params.session}.data.json'|require('path').resolve(process.cwd(), 'tokens', req.params.session + '.data.json')|g" "$f"
  sed -i 's|__dirname + `../../../tokens/${session}.data.json`|require("path").resolve(process.cwd(), "tokens", session + ".data.json")|g' "$f"
  sed -i 's|__dirname + `../../../tokens/${req.session}.data.json`|require("path").resolve(process.cwd(), "tokens", req.session + ".data.json")|g' "$f"
  sed -i 's|__dirname + `../../../tokens/${req.params.session}.data.json`|require("path").resolve(process.cwd(), "tokens", req.params.session + ".data.json")|g' "$f"
  sed -i 's|__dirname + "../../../tokens/" + session + ".data.json"|require("path").resolve(process.cwd(), "tokens", session + ".data.json")|g' "$f"
  sed -i 's|__dirname + "../../../tokens/" + req.session + ".data.json"|require("path").resolve(process.cwd(), "tokens", req.session + ".data.json")|g' "$f"
  sed -i 's|__dirname + "../../../tokens/" + req.params.session + ".data.json"|require("path").resolve(process.cwd(), "tokens", req.params.session + ".data.json")|g' "$f"
  sed -i "s|__dirname + '../../../tokens/' + session + '.data.json'|require('path').resolve(process.cwd(), 'tokens', session + '.data.json')|g" "$f"
  sed -i "s|__dirname + '../../../tokens/' + req.session + '.data.json'|require('path').resolve(process.cwd(), 'tokens', req.session + '.data.json')|g" "$f"
  sed -i 's|require("path").join(process.cwd(), "tokens", `${session}.data.json`)|require("path").resolve(process.cwd(), "tokens", session + ".data.json")|g' "$f"
  sed -i 's|require("path").join(process.cwd(), "tokens", `${req.session}.data.json`)|require("path").resolve(process.cwd(), "tokens", req.session + ".data.json")|g' "$f"
}

for f in $(find . \( -path './node_modules/*' \) -prune -o \
  \( -name 'miscController.js' -o -name 'sessionController.js' \) ! -name '*.bak*' -print 2>/dev/null); do
  patch_one_file "$f"
done

echo ""
# Não confundir com arquivos .bak.* (cópia de segurança do próprio script)
if grep '__dirname.*tokens/' ./dist/controller/miscController.js ./dist/controller/sessionController.js 2>/dev/null | grep -q .; then
  echo "ERRO: patch incompleto nos arquivos ativos:"
  grep -n '__dirname.*tokens/' ./dist/controller/miscController.js ./dist/controller/sessionController.js 2>/dev/null | head -5
  echo "Use deploy/APAGAR-TOKENS-MANUAL.sh no GitHub Zap para limpar tokens à mão."
  exit 1
fi
echo "OK: patch de tokens aplicado (miscController + sessionController)."

echo ""
echo "=== 3) Variáveis no EasyPanel (serviço wppconnect) ==="
echo "  WPP_START_ALL_SESSION=false"
echo "  WPP_AUTO_CLOSE=0"
echo ""
echo "=== PRONTO ==="
echo "1) Reinicie o wppconnect (Stop -> Start, 1 réplica)"
echo "2) No Zap: Limpar órfãs ou Remover instâncias"
echo "3) Se ainda falhar: cole deploy/APAGAR-TOKENS-MANUAL.sh (GitHub victorhamber/zap)"
