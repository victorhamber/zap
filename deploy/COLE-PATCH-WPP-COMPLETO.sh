#!/bin/sh
# Cole INTEIRO no console EasyPanel do wppconnect. Aplica:
# 1) patch path tokens (clear-session-data)
# 2) rota zap-force-clear-session (o painel Zap usa para Remover / Apagar órfã)
cd /usr/src/wpp-server || cd /app || exit 1

echo "=== 1) Patch tokens (misc + sessionController) ==="
node <<'NODE'
const fs = require("fs");
const files = ["dist/controller/miscController.js", "dist/controller/sessionController.js"];
const reps = [
  ["__dirname + '../../../tokens/${session}.data.json'", "require('path').resolve(process.cwd(), 'tokens', session + '.data.json')"],
  ["__dirname + '../../../tokens/${req.session}.data.json'", "require('path').resolve(process.cwd(), 'tokens', req.session + '.data.json')"],
  ["__dirname + '../../../tokens/${req.params.session}.data.json'", "require('path').resolve(process.cwd(), 'tokens', req.params.session + '.data.json')"],
  ['__dirname + `../../../tokens/${session}.data.json`', "require('path').resolve(process.cwd(), 'tokens', session + '.data.json')"],
  ['__dirname + `../../../tokens/${req.session}.data.json`', "require('path').resolve(process.cwd(), 'tokens', req.session + '.data.json')"],
];
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  let s = fs.readFileSync(f, "utf8");
  for (const [a, b] of reps) if (s.includes(a)) s = s.split(a).join(b);
  fs.writeFileSync(f, s);
  console.log("patched:", f);
}
NODE

echo ""
echo "=== 2) Rota zap-force-clear-session (limpeza igual ao manual) ==="
node <<'NODE'
const fs = require("fs");
const path = require("path");
const miscPath = "dist/controller/miscController.js";
const routesPath = "dist/routes/index.js";
if (!fs.existsSync(miscPath)) { console.error("sem miscController"); process.exit(1); }
const HANDLER = `
async function zapForceClearSession(req, res) {
  try {
    const secretkey = req.params.secretkey;
    const sessionName = String(req.params.session || "").trim();
    const config = require("../config").default || require("../config");
    if (secretkey !== config.secretKey) {
      return res.status(400).json({ response: "error", message: "The token is incorrect" });
    }
    if (!sessionName) return res.status(400).json({ success: false, message: "session required" });
    const fs = require("fs");
    const pathModule = require("path");
    const removed = { token: false, userDataDir: false, customUserDataDir: false };
    const tokenPath = pathModule.resolve(process.cwd(), "tokens", sessionName + ".data.json");
    if (fs.existsSync(tokenPath)) { await fs.promises.rm(tokenPath, { force: true }); removed.token = true; }
    const userPath = pathModule.resolve(process.cwd(), "userDataDir", sessionName);
    if (fs.existsSync(userPath)) { await fs.promises.rm(userPath, { recursive: true, force: true }); removed.userDataDir = true; }
    const customBase = config.customUserDataDir || "";
    if (customBase) {
      const customPath = String(customBase) + sessionName;
      if (fs.existsSync(customPath)) { await fs.promises.rm(customPath, { recursive: true, force: true }); removed.customUserDataDir = true; }
    }
    try {
      const { clientsArray } = require("../util/sessionUtil");
      if (req.client && req.client.page) { delete clientsArray[sessionName]; await req.client.logout(); }
      else if (clientsArray[sessionName]) delete clientsArray[sessionName];
    } catch (_) {}
    return res.status(200).json({ success: true, removed, tokenPath });
  } catch (error) {
    return res.status(500).json({ success: false, message: String(error && error.message || error) });
  }
}
`;
let misc = fs.readFileSync(miscPath, "utf8");
if (!misc.includes("zapForceClearSession")) {
  misc = misc.trimEnd() + HANDLER + "\nexports.zapForceClearSession = zapForceClearSession;\n";
  fs.writeFileSync(miscPath, misc);
  console.log("OK miscController.zapForceClearSession");
}
if (fs.existsSync(routesPath)) {
  let routes = fs.readFileSync(routesPath, "utf8");
  const line = "routes.post('/api/:session/:secretkey/zap-force-clear-session', MiscController.zapForceClearSession);";
  if (!routes.includes("zap-force-clear-session")) {
    const re = /routes\.post\(\s*['"]\/api\/:session\/:secretkey\/clear-session-data['"]\s*,\s*[^)]+\)\s*;?/;
    routes = re.test(routes) ? routes.replace(re, (m) => m + "\n" + line) : routes.trimEnd() + "\n" + line + "\n";
    fs.writeFileSync(routesPath, routes);
    console.log("OK rota registrada");
  } else console.log("rota já existe");
}
NODE

echo ""
grep -q zap-force-clear-session ./dist/routes/index.js 2>/dev/null && echo "Rota OK" || echo "AVISO: confira dist/routes/index.js"
echo ""
echo "=== REINICIE o wppconnect (Stop -> Start) ==="
echo "Redeploy do serviço ZAP para usar a API nova. Depois: Apagar 454 / Remover instância."
