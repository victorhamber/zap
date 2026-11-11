# MAP/deploy

## deploy/
- APAGAR-TOKENS-MANUAL.sh [46L] EMERGÊNCIA: apaga tokens/*.data.json e userDataDir no container wppconnect
- COLE-DIAGNOSTICO-E-LIMPAR.sh [45L] Cole no console wppconnect APÓS o patch Node.
- COLE-NO-CONSOLE-WPPCONNECT.sh [65L] COLE ESTE ARQUIVO INTEIRO no console EasyPanel do serviço wppconnect (aba Sh).
- COLE-PATCH-TOKENS-IBSDDEV.sh [57L] Patch tokens — imagem ibsddev. Cole INTEIRO no console wppconnect (aba Sh/Bash).
- COLE-PATCH-WPP-COMPLETO.sh [91L] Cole INTEIRO no console EasyPanel do wppconnect. Aplica:
- Dockerfile.wppconnect [22L] WPPConnect com patch para apagar tokens ao excluir sessão (clear-session-data).
- docker-wpp-entrypoint.sh [11L] Entrypoint opcional: aplica patch de tokens antes de subir o WPP.
- easypanel-waha.md [53L] WAHA no EasyPanel
- patch-wpp-token-node.js [85L] usr/bin/env node
- patch-wpp-token-path.sh [11L] Corrige bug do WPPConnect 2.x: clear-session-data não apaga tokens/*.data.json
- patch-wpp-zap-force-route.js [116L] usr/bin/env node — zapForceClearSession()
- wppconnect-config-fix.sh [47L] Cole ESTE BLOCO INTEIRO no console EasyPanel do serviço wppconnect (aba Console 
