# sendmaster
Fontes: Send Master/*
Propósito: plugin WordPress SendMaster 0.1.47 (`gerenciamento-emails-avancado.php`). Fila, agendamento, tracking e fluxos de e-mail. Não entra no painel React do Zap.

## API pública
- `includes/assets.php` enfileira `admin-enhanced.css`, `landing-page-builder.css`, `flow-studio.css`, `visual-form-builder.css`, `public-forms.css` e `smtp-config.css`.
- `includes/admin-page.php` enfileira `ge-modern-admin.css`. `includes/admin-tabs/license.php` enfileira `license-admin.css`.
- `includes/class-sendmaster-app.php` carrega `sendmaster-app.css` na área `body.sm-app`. `includes/forms.php` e `includes/ajax/forms.php` usam `public-forms.css` e `public-forms.js`.
- `includes/assets.php` enfileira o JS do admin (`admin-enhanced-fixed.js`), do fluxo (`flow-studio-linear.js`), dos formulários (`form-builder.js`, `visual-form-builder.js`), da landing (`landing-page-builder.js`), de SMTP, usuários, heartbeat, tracking e pixel. `license-admin.js` entra por `admin-tabs/license.php`.

## Depende de / Usado por
- Depende: WordPress (`wp_enqueue_style`) e a constante `GE_ADVANCED_PLUGIN_URL`.
- Usado por: telas admin do plugin. O inbox, o funil e o dashboard do Zap não importam esses arquivos.

## Invariantes e armadilhas
- Classes `ge-*` são do plugin. Não misturar com `web/src/styles.css` do Zap.
- `smtp-config.css` é enfileirado com `time()` na versão, então o navegador não guarda cache.
- `cli.php` ainda aponta CSS que não estão nesta pasta (`react-flow-nodes.css`, `react-flow-custom.css`, `flow-nodes-fix.css`).
