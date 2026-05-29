#!/bin/sh
# Entrypoint opcional: aplica patch de tokens antes de subir o WPP.
for d in /usr/src/wpp-server /app /opt/wppconnect-server; do
  if [ -f "$d/dist/controller/miscController.js" ] || [ -f "$d/src/controller/miscController.ts" ]; then
    sh /patch-wpp-token-path.sh "$d" || true
    node /patch-wpp-zap-force-route.js "$d" 2>/dev/null || true
    break
  fi
done
exec "$@"
