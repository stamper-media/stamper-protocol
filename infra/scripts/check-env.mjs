#!/usr/bin/env node
// Asserts that infra/.env.example documents every environment variable the code reads:
// process.env.X / process.env["X"] / env("X") in TS/JS, the zod keys of services/api/src/config.ts,
// and e.get("X") / os.environ in services/ml. A key counts as documented when it appears as
// `KEY=` or `# KEY=` at the start of a line. Exit 0 = superset, 1 = missing keys, 2 = usage error.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const infra = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = process.argv[2] ?? join(infra, "..");
// The code that reads env lives in four repos; the siblings are scanned when they sit beside this one
// (or under STAMPER_REPOS_DIR). Absent ones are skipped.
const reposDir = process.env.STAMPER_REPOS_DIR ?? join(root, "..");
const roots = process.argv[2]
  ? [root]
  : [
      root,
      ...["stamper-services", "stamper-app", "stamper-explorer"].map((r) => join(reposDir, r)),
    ];
const examplePath = process.argv[3] ?? join(infra, ".env.example");
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".expo",
  "coverage",
  "build",
  ".venv",
  "venv",
  "__pycache__",
  "test-results",
  "ios",
  "android",
]);
const STANDARD = new Set([
  "NODE_ENV",
  "CI",
  "HOME",
  "PATH",
  "TZ",
  "TMPDIR",
  "PWD",
  "USER",
  "SHELL",
  "LANG",
  "NODE_OPTIONS",
  "DEBUG",
  "VITEST",
  "TERM",
]);
const SCAN = ["packages", "services", "apps", "e2e"];
const CODE = /\.(m?[jt]sx?|cjs|py)$/;
const PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /\benv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /\b(?:e|env|environ|os\.environ)\.get\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /os\.environ\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) yield* walk(p);
    else if (CODE.test(name) && !name.endsWith(".d.ts")) yield p;
  }
}

/** @type {Map<string, string>} key -> first file that reads it */
const used = new Map();
const add = (k, file) => {
  if (!k.endsWith("_") && !STANDARD.has(k) && !used.has(k)) used.set(k, relative(root, file));
};
for (const top of roots.flatMap((r) => SCAN.map((s) => join(r, s)))) {
  for (const file of walk(top)) {
    const src = readFileSync(file, "utf8");
    for (const re of PATTERNS) for (const m of src.matchAll(re)) add(m[1], file);
    if (file.endsWith(join("services", "api", "src", "config.ts"))) {
      for (const m of src.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)) add(m[1], file);
    }
  }
}
let example;
try {
  example = readFileSync(examplePath, "utf8");
} catch {
  console.error(`check-env: cannot read ${examplePath}`);
  process.exit(2);
}
const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
const missing = [...used].filter(([k]) => !documented.has(k)).sort();
if (missing.length > 0) {
  console.error(`check-env: ${missing.length} key(s) read by code but missing from .env.example:`);
  for (const [k, f] of missing) console.error(`  ${k}  (${f})`);
  process.exit(1);
}
console.log(`check-env: ok (${used.size} keys read by code, all documented)`);
