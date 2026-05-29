#!/bin/sh
# Entrypoint opcional: aplica patch de tokens antes de subir o WPP.
for d in /usr/src/wpp-server /app /opt/wppconnect-server; do
  if [ -f "$d/dist/controller/miscController.js" ] || [ -f "$d/src/controller/miscController.ts" ]; then
    sh /patch-wpp-token-path.sh "$d" || true
    break
  fi
done
exec "$@"
