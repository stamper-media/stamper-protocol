#!/usr/bin/env node
// Purity gate for runtime-agnostic packages (@stamper/core, @stamper/minimise).
// Usage: node scripts/check-pure.mjs <package-dir-or-dist-dir> [...more]
// Scans every emitted .js/.mjs/.cjs file under <dir>/dist (or <dir> itself when it
// has no dist/) and fails if it references a Node built-in: a `node:` specifier,
// a bare built-in module specifier (e.g. "fs"), `require(`, `Buffer.`/`Buffer(` or
// `process.`. Comments are ignored. Exit codes: 0 clean, 1 violations, 2 usage.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith("_")));
const RULES = [
  { name: "node: specifier", re: /["'`]node:[a-z_/]+["'`]/ },
  { name: "require()", re: /(?<![\w$.])require\s*\(/ },
  { name: "Buffer", re: /(?<![\w$.])Buffer\s*[.(]/ },
  { name: "process", re: /(?<![\w$.])process\s*\./ },
  {
    name: "globalThis Node global",
    re: /\bglobalThis\s*(?:\?\.|\.)\s*(?:process|Buffer|require)\b/,
  },
];
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
const JS_EXT = /\.(?:m|c)?js$/;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile() && JS_EXT.test(entry.name)) yield p;
  }
}

function stripComments(src) {
  // Remove block comments (keeping line count), then drop whole-line // comments.
  return (
    src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
      .split("\n")
      // Trailing `// ...` comments: only when `//` follows whitespace or a statement
      // boundary, so "https://..." inside a string literal is left intact.
      .map((line) => line.replace(/(^|[\s;,{}()])\/\/.*$/, "$1"))
  );
}

export function scanSource(src) {
  const hits = [];
  stripComments(src).forEach((line, i) => {
    for (const { name, re } of RULES) if (re.test(line)) hits.push({ line: i + 1, rule: name });
    for (const m of line.matchAll(SPECIFIER)) {
      const spec = m[1];
      const base = spec.split("/")[0];
      if (BUILTINS.has(spec) || (BUILTINS.has(base) && !spec.startsWith(".")))
        hits.push({ line: i + 1, rule: `built-in import "${spec}"` });
    }
  });
  return hits;
}

function targetDir(arg) {
  const abs = resolve(arg);
  const st = statSync(abs, { throwIfNoEntry: false });
  if (!st?.isDirectory()) throw new Error(`not a directory: ${arg}`);
  const dist = join(abs, "dist");
  return statSync(dist, { throwIfNoEntry: false })?.isDirectory() ? dist : abs;
}

function main(argv) {
  if (argv.length === 0) {
    console.error("usage: node scripts/check-pure.mjs <dir> [...dirs]");
    return 2;
  }
  let violations = 0;
  let files = 0;
  for (const arg of argv) {
    let dir;
    try {
      dir = targetDir(arg);
    } catch (e) {
      console.error(`check-pure: ${e.message}`);
      return 2;
    }
    for (const file of walk(dir)) {
      files++;
      for (const h of scanSource(readFileSync(file, "utf8"))) {
        violations++;
        console.error(`${relative(process.cwd(), file)}:${h.line}  ${h.rule}`);
      }
    }
  }
  if (files === 0) {
    console.error("check-pure: no .js files found (build first?)");
    return 2;
  }
  if (violations > 0) {
    console.error(`check-pure: ${violations} Node built-in reference(s) in ${files} file(s)`);
    return 1;
  }
  console.log(`check-pure: ${files} file(s) clean`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
