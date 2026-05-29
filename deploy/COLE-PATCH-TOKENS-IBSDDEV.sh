#!/bin/sh
# Patch tokens — imagem ibsddev. Cole INTEIRO no console wppconnect (aba Sh/Bash).
# O path no arquivo é ../../../ (TRÊS níveis), não ../../../../
cd /usr/src/wpp-server || cd /app || exit 1

echo "=== Patch token path (Node — evita erro de sed) ==="
for f in ./dist/controller/miscController.js ./dist/controller/sessionController.js; do
  [ -f "$f" ] || continue
  cp "$f" "${f}.bak.fix.$(date +%s)"
done

node <<'NODE'
const fs = require("fs");
const files = [
  "dist/controller/miscController.js",
  "dist/controller/sessionController.js",
];
const reps = [
  [
    "__dirname + '../../../tokens/${session}.data.json'",
    "require('path').resolve(process.cwd(), 'tokens', session + '.data.json')",
  ],
  [
    "__dirname + '../../../tokens/${req.session}.data.json'",
    "require('path').resolve(process.cwd(), 'tokens', req.session + '.data.json')",
  ],
  [
    "__dirname + '../../../tokens/${req.params.session}.data.json'",
    "require('path').resolve(process.cwd(), 'tokens', req.params.session + '.data.json')",
  ],
];
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log("skip (missing):", f);
    continue;
  }
  let s = fs.readFileSync(f, "utf8");
  let hits = 0;
  for (const [from, to] of reps) {
    if (s.includes(from)) {
      s = s.split(from).join(to);
      hits++;
    }
  }
  if (hits) fs.writeFileSync(f, s);
  console.log(hits ? "OK patched:" : "no match:", f);
}
NODE

echo ""
if grep '__dirname.*tokens' ./dist/controller/miscController.js ./dist/controller/sessionController.js 2>/dev/null | grep -q .; then
  echo "ERRO: ainda há __dirname + tokens (mostre ao suporte):"
  grep -n '__dirname.*tokens' ./dist/controller/miscController.js ./dist/controller/sessionController.js
  exit 1
fi
echo "OK. Reinicie o wppconnect e teste Remover / Limpar órfãs no Zap."
