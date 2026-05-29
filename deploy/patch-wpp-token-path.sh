#!/bin/sh
# Corrige bug do WPPConnect 2.x: clear-session-data não apaga tokens/*.data.json
ROOT="${1:-.}"
cd "$ROOT" || exit 1
echo "=== Patch token path (Node) ==="
echo "    cwd: $(pwd)"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node "$SCRIPT_DIR/patch-wpp-token-node.js" "$(pwd)" || exit 1
node "$SCRIPT_DIR/patch-wpp-zap-force-route.js" "$(pwd)" 2>/dev/null || true
echo "OK. Reinicie o wppconnect (Stop -> Start) antes de testar Remover no Zap."
