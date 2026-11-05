#!/usr/bin/env node
// Builds the publishable @stamper/* packages and packs each one into .packs/<name>.tgz with a
// stable file name (stamper-core.tgz, …). Those tarballs are exactly what `pnpm publish` would
// upload. Until the packages are on npm, the other Stamper repos install them from a vendored copy
// of these files (their scripts/sync-protocol.sh copies .packs/ into vendor/).
//   node scripts/pack-packages.mjs            # build + pack all
//   node scripts/pack-packages.mjs --no-build # pack only
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, ".packs");
const build = !process.argv.includes("--no-build");
const pkgs = readdirSync(join(root, "packages")).filter((d) => {
  try {
    const j = JSON.parse(readFileSync(join(root, "packages", d, "package.json"), "utf8"));
    return !j.private;
  } catch {
    return false;
  }
});

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
if (build)
  execFileSync("pnpm", ["-r", "--filter", "./packages/*", "build"], {
    cwd: root,
    stdio: "inherit",
  });
for (const d of pkgs) {
  const dir = join(root, "packages", d);
  const { name, version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const before = new Set(readdirSync(out));
  execFileSync("pnpm", ["pack", "--pack-destination", out], {
    cwd: dir,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const made = readdirSync(out).find((f) => !before.has(f));
  if (!made) throw new Error(`pnpm pack wrote nothing for ${name}`);
  const stable = `${name.replace(/^@/, "").replace("/", "-")}.tgz`;
  renameSync(join(out, made), join(out, stable));
  console.log(`${name}@${version} -> .packs/${stable}`);
}
