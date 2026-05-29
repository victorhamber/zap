#!/usr/bin/env node
/**
 * Adiciona POST /api/:session/:secretkey/zap-force-clear-session no WPPConnect.
 * Mesma lógica do APAGAR-TOKENS-MANUAL (tokens + userDataDir), chamável pelo Zap.
 */
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || process.cwd();
process.chdir(root);

const miscPath = path.join(root, "dist/controller/miscController.js");
const routesPath = path.join(root, "dist/routes/index.js");

if (!fs.existsSync(miscPath)) {
  console.error("miscController.js não encontrado em", miscPath);
  process.exit(1);
}

const HANDLER = `
async function zapForceClearSession(req, res) {
  try {
    const secretkey = req.params.secretkey;
    const sessionName = String(req.params.session || "").trim();
    const config = require("../config").default || require("../config");
    if (secretkey !== config.secretKey) {
      return res.status(400).json({ response: "error", message: "The token is incorrect" });
    }
    if (!sessionName) {
      return res.status(400).json({ success: false, message: "session required" });
    }
    const fs = require("fs");
    const pathModule = require("path");
    const removed = { token: false, userDataDir: false, customUserDataDir: false };
    const tokenPath = pathModule.resolve(process.cwd(), "tokens", sessionName + ".data.json");
    if (fs.existsSync(tokenPath)) {
      await fs.promises.rm(tokenPath, { force: true });
      removed.token = true;
    }
    const userPath = pathModule.resolve(process.cwd(), "userDataDir", sessionName);
    if (fs.existsSync(userPath)) {
      await fs.promises.rm(userPath, { recursive: true, force: true });
      removed.userDataDir = true;
    }
    const customBase = config.customUserDataDir || "";
    if (customBase) {
      const customPath = String(customBase) + sessionName;
      if (fs.existsSync(customPath)) {
        await fs.promises.rm(customPath, { recursive: true, force: true });
        removed.customUserDataDir = true;
      }
    }
    try {
      const { clientsArray } = require("../util/sessionUtil");
      if (req.client && req.client.page) {
        delete clientsArray[sessionName];
        await req.client.logout();
      } else if (clientsArray[sessionName]) {
        delete clientsArray[sessionName];
      }
    } catch (_) {}
    return res.status(200).json({ success: true, removed, tokenPath });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "zap-force-clear-session failed",
      error: error && error.message ? error.message : String(error),
    });
  }
}
`;

let misc = fs.readFileSync(miscPath, "utf8");
if (!misc.includes("zapForceClearSession")) {
  if (!misc.includes("exports.zapForceClearSession")) {
    misc = misc.trimEnd() + HANDLER + "\nexports.zapForceClearSession = zapForceClearSession;\n";
    fs.writeFileSync(miscPath, misc);
    console.log("OK: zapForceClearSession em miscController.js");
  }
} else {
  console.log("já ok: miscController zapForceClearSession");
}

if (!fs.existsSync(routesPath)) {
  console.warn("AVISO: routes/index.js não encontrado — registre a rota manualmente");
  process.exit(0);
}

let routes = fs.readFileSync(routesPath, "utf8");
const routeLine =
  "routes.post('/api/:session/:secretkey/zap-force-clear-session', MiscController.zapForceClearSession);";

if (routes.includes("zap-force-clear-session")) {
  console.log("já ok: rota zap-force-clear-session");
} else {
  const patterns = [
    /routes\.post\(\s*['"]\/api\/:session\/:secretkey\/clear-session-data['"]\s*,\s*MiscController\.clearSessionData\s*\)\s*;?/,
    /routes\.post\(\s*['"]\/api\/:session\/:secretkey\/clear-session-data['"]\s*,\s*[^)]+\.clearSessionData\s*\)\s*;?/,
  ];
  let inserted = false;
  for (const re of patterns) {
    if (re.test(routes)) {
      routes = routes.replace(re, (m) => `${m}\n${routeLine}`);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    routes = routes.trimEnd() + `\n${routeLine}\n`;
  }
  fs.writeFileSync(routesPath, routes);
  console.log("OK: rota zap-force-clear-session registrada");
}

process.exit(0);
