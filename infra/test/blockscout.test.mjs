// Blockscout source publication: helper units + deploy-*.sh --verify-only against a mock explorer and a
// stub forge (no network, no keys). Regression for the Calibration deploy whose sources never got published.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { constructorArgs, contractUrl, publication } from "../scripts/lib/blockscout.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const REG = "0xb64F15D327C9953C8fCaB3700C5e92772a5021c9";
const RES = "0x08298D447E7f1215939E48A64FEfF75075722B0c";
const GOV = "0x71491a75Dd0D66519313736b8167a2B6bb498131";
const word = (a) => a.slice(2).toLowerCase().padStart(64, "0");
const TWIN = {
  is_verified: false,
  name: "FilecoinMarketConsumer",
  verified_twin_address_hash: "0xad8BC443766AaA8ffB214fD2F8E1Dc5Cac7F6B0D",
};
const CODE = { StampRegistry: "0x6080604052aa", StampResolver: "0x6080604052bb" };
const ARGS = { StampRegistry: word(RES) + word(GOV) + word(GOV), StampResolver: word(GOV) };
const NAME = { [REG.toLowerCase()]: "StampRegistry", [RES.toLowerCase()]: "StampResolver" };

test("contractUrl derives the v2 REST URL from the forge verifier URL", () => {
  for (const api of [
    "https://filecoin-testnet.blockscout.com/api/",
    "https://filecoin-testnet.blockscout.com/api",
    "https://filecoin-testnet.blockscout.com/",
  ]) {
    assert.equal(
      contractUrl(api, REG),
      `https://filecoin-testnet.blockscout.com/api/v2/smart-contracts/${REG}`,
    );
  }
  assert.equal(
    contractUrl("http://127.0.0.1:9/x/api/", REG),
    `http://127.0.0.1:9/x/api/v2/smart-contracts/${REG}`,
  );
  assert.throws(() => contractUrl("ftp://h/api/", REG), /protocol/);
  assert.throws(() => contractUrl("https://h/api/", "0x123"), /not an address/);
});

test("constructorArgs strips the local creation code and rejects a different build", () => {
  const args = word(GOV);
  assert.equal(constructorArgs(`0x6080aa${args}`, "0x6080AA"), `0x${args}`);
  assert.equal(constructorArgs("0x6080aa", "0x6080aa"), "0x");
  assert.throws(() => constructorArgs(`0x6080bb${args}`, "0x6080aa", "X"), /local build differs/);
  assert.throws(() => constructorArgs("0x6080aa00", "0x6080aa"), /32-byte words/);
  assert.throws(() => constructorArgs("0x6080", "0x60__$abc$__"), /unlinked library/);
  assert.throws(() => constructorArgs(undefined, "0x60"), /missing/);
});

test("publication: only is_verified under the expected name counts, never a verified twin", () => {
  assert.equal(publication(null, "StampRegistry").ok, false);
  assert.equal(publication(TWIN, "StampRegistry").ok, false);
  assert.match(publication(TWIN, "StampRegistry").reason, /unrelated twin FilecoinMarketConsumer/);
  assert.equal(publication({ ...TWIN, is_verified: true }, "StampRegistry").ok, false);
  assert.equal(publication({ is_verified: true, name: "StampRegistry" }, "StampRegistry").ok, true);
});

function exec(cmd, args, env) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

/** Fixture foundry tree + stub forge/cast + mock Blockscout; `state(addr, hits, fx)` returns a record or null. */
async function harness(chainId, state) {
  const root = mkdtempSync(join(tmpdir(), "stamper-wp11-verify-"));
  const contracts = join(root, "contracts");
  mkdirSync(join(contracts, "deployments"), { recursive: true });
  const net = chainId === 314 ? "mainnet" : "calibration";
  writeFileSync(
    join(contracts, "deployments", `${net}.json`),
    JSON.stringify({ chainId, registry: REG, resolver: RES }),
  );
  for (const name of Object.keys(CODE)) {
    mkdirSync(join(contracts, "out", `${name}.sol`), { recursive: true });
    writeFileSync(
      join(contracts, "out", `${name}.sol`, `${name}.json`),
      JSON.stringify({ bytecode: { object: CODE[name] } }),
    );
  }
  const bin = join(root, "bin");
  mkdirSync(bin);
  const forgeLog = join(root, "forge.log");
  writeFileSync(
    join(bin, "forge"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >>"${forgeLog}"\n[[ "$1" != verify-contract ]] || touch "${root}/submitted-$2"\n`,
  );
  writeFileSync(join(bin, "cast"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(bin, "forge"), 0o755);
  chmodSync(join(bin, "cast"), 0o755);
  const fx = {
    submitted: (a) => existsSync(join(root, `submitted-${a}`)),
    forgeLog: () => (existsSync(forgeLog) ? readFileSync(forgeLog, "utf8") : ""),
  };
  const hits = {};
  const server = createServer((req, res) => {
    const m = /^\/api\/v2\/smart-contracts\/(0x[0-9a-fA-F]{40})$/.exec(req.url ?? "");
    const addr = m?.[1];
    hits[addr] = (hits[addr] ?? 0) + 1;
    const rec = addr && NAME[addr.toLowerCase()] ? state(addr, hits[addr], fx) : null;
    res.writeHead(rec ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(rec ?? { message: "Not found" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const api = `http://127.0.0.1:${server.address().port}/api/`;
  const { PATH, STAMPER_HEAVY_LOCK: _lock, ...rest } = process.env;
  const env = {
    ...rest,
    PATH: `${bin}:${PATH}`,
    STAMPER_CONTRACTS_DIR: contracts,
    BLOCKSCOUT_URL: api,
    MAINNET_BLOCKSCOUT_URL: api,
    VERIFY_POLL_INTERVAL_S: "0.1",
    VERIFY_STATUS_TIMEOUT_S: "1",
    VERIFY_INDEX_TIMEOUT_S: "2",
  };
  const script = join(SCRIPTS, chainId === 314 ? "deploy-mainnet.sh" : "deploy-calibration.sh");
  return {
    api,
    fx,
    run: () => exec("bash", [script, "--verify-only"], env),
    close: () => {
      server.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const record = (addr, verified, prefix) => {
  const name = NAME[addr.toLowerCase()];
  const base = {
    creation_bytecode: (prefix ?? CODE[name]) + ARGS[name],
    deployed_bytecode: "0xfe",
  };
  return verified ? { ...base, is_verified: true, name } : { ...base, ...TWIN };
};

test("--verify-only fails loudly while Blockscout shows only the verified twin", async () => {
  const h = await harness(314159, (addr) => record(addr, false));
  try {
    const r = await h.run();
    assert.notEqual(r.code, 0, r.err);
    assert.match(r.err, /Blockscout source publication FAILED/);
    assert.match(r.err, /unrelated twin FilecoinMarketConsumer/);
    const log = h.fx.forgeLog();
    for (const [addr, name] of [
      [REG, "StampRegistry"],
      [RES, "StampResolver"],
    ]) {
      assert.ok(
        log.includes(
          `verify-contract ${addr} src/${name}.sol:${name} --chain 314159 --verifier blockscout ` +
            `--verifier-url ${h.api} --constructor-args 0x${ARGS[name]} --skip-is-verified-check --watch`,
        ),
        log,
      );
    }
  } finally {
    h.close();
  }
});

test("--verify-only waits for indexing, submits, and passes once Blockscout reports both verified", async () => {
  const h = await harness(314159, (addr, hits, fx) =>
    hits <= 2 ? null : record(addr, fx.submitted(addr)),
  );
  try {
    const r = await h.run();
    assert.equal(r.code, 0, r.err);
    assert.ok(h.fx.submitted(REG) && h.fx.submitted(RES));
    assert.match(r.err, /sources are published/);
  } finally {
    h.close();
  }
});

test("--verify-only skips contracts already verified (calibration and mainnet)", async () => {
  for (const chainId of [314159, 314]) {
    const h = await harness(chainId, (addr) => record(addr, true));
    try {
      const r = await h.run();
      assert.equal(r.code, 0, r.err);
      assert.match(r.err, /StampRegistry 0x\S+ is already verified/);
      assert.doesNotMatch(h.fx.forgeLog(), /verify-contract/);
    } finally {
      h.close();
    }
  }
});

test("--verify-only refuses when the local build differs from the deployed creation code", async () => {
  const h = await harness(314159, (addr) => record(addr, false, "0x6080604052ff"));
  try {
    const r = await h.run();
    assert.notEqual(r.code, 0);
    assert.match(r.err, /local build differs/);
    assert.doesNotMatch(h.fx.forgeLog(), /verify-contract/);
  } finally {
    h.close();
  }
});
