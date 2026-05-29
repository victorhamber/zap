#!/usr/bin/env node
/**
 * Corrige path de tokens no WPPConnect 2.x (ibsddev e oficial).
 * Uso: node patch-wpp-token-node.js [/usr/src/wpp-server]
 */
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || process.cwd();
process.chdir(root);

const files = [
  "dist/controller/miscController.js",
  "dist/controller/sessionController.js",
  "src/controller/miscController.ts",
  "src/controller/sessionController.ts",
];

const literalReps = [
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
  [
    '__dirname + `../../../tokens/${session}.data.json`',
    "require('path').resolve(process.cwd(), 'tokens', session + '.data.json')",
  ],
  [
    '__dirname + `../../../tokens/${req.session}.data.json`',
    "require('path').resolve(process.cwd(), 'tokens', req.session + '.data.json')",
  ],
  [
    '__dirname + `../../../tokens/${req.params.session}.data.json`',
    "require('path').resolve(process.cwd(), 'tokens', req.params.session + '.data.json')",
  ],
];

const regexReps = [
  [
    /__dirname\s*\+\s*['"`]\.\.\/\.\.\/\.\.\/tokens\/\$\{session\}\.data\.json['"`]/g,
    "require('path').resolve(process.cwd(), 'tokens', session + '.data.json')",
  ],
  [
    /__dirname\s*\+\s*['"`]\.\.\/\.\.\/\.\.\/tokens\/\$\{req\.session\}\.data\.json['"`]/g,
    "require('path').resolve(process.cwd(), 'tokens', req.session + '.data.json')",
  ],
  [
    /__dirname\s*\+\s*['"`]\.\.\/\.\.\/\.\.\/tokens\/\$\{req\.params\.session\}\.data\.json['"`]/g,
    "require('path').resolve(process.cwd(), 'tokens', req.params.session + '.data.json')",
  ],
];

let exitCode = 0;
for (const rel of files) {
  const f = path.join(root, rel);
  if (!fs.existsSync(f)) continue;
  let s = fs.readFileSync(f, "utf8");
  const before = s;
  for (const [from, to] of literalReps) {
    if (s.includes(from)) s = s.split(from).join(to);
  }
  for (const [re, to] of regexReps) {
    s = s.replace(re, to);
  }
  if (s !== before) {
    fs.writeFileSync(f, s);
    console.log("OK patched:", rel);
  } else if (/__dirname.*tokens/.test(s)) {
    console.log("AVISO: __dirname+tokens ainda em", rel);
    exitCode = 1;
  } else {
    console.log("já ok:", rel);
  }
}

process.exit(exitCode);
