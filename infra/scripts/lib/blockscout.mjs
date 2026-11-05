#!/usr/bin/env node
// Blockscout helpers for the deploy scripts (Node 22, no dependencies, no env reads).
//
//   node blockscout.mjs ctor-args --api <url> --address <0x…> --artifact <out/X.sol/X.json>
//                                 [--timeout-s N] [--interval-s N]
//     Waits until Blockscout has indexed the contract's creation input, checks that the local build's
//     creation bytecode is a prefix of it, and prints the ABI-encoded constructor arguments (0x…).
//   node blockscout.mjs status --api <url> --address <0x…> --name <Contract> [--timeout-s N] [--interval-s N]
//     Waits until Blockscout reports the address as verified under <Contract>.
//
// <url> is the Etherscan-compatible API root forge takes as --verifier-url
// (https://filecoin-testnet.blockscout.com/api/); the v2 REST API is derived from it. The v2 record is the
// source of truth: on Filecoin, Blockscout indexes fresh FEVM contracts with runtime code 0xfe and attaches
// an unrelated "verified twin" whose source getsourcecode then returns, so forge's own "already verified"
// check reports success for a contract that is not verified.
//
// Exit codes: 0 ok, 1 not verified, 2 local build differs from the deployed creation code,
// 3 not indexed in time / explorer unreachable, 64 usage.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export class BlockscoutError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

/** v2 REST URL of a smart contract, derived from the Etherscan-compatible API root. */
export function contractUrl(api, address) {
  if (!ADDRESS.test(address ?? "")) throw new BlockscoutError(`not an address: ${address}`, 64);
  let u;
  try {
    u = new URL(api);
  } catch {
    throw new BlockscoutError(`not a URL: ${api}`, 64);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new BlockscoutError(`unsupported URL protocol: ${api}`, 64);
  }
  const base = u.pathname.replace(/\/+$/, "").replace(/\/api$/, "");
  return `${u.origin}${base}/api/v2/smart-contracts/${address}`;
}

function hexBody(value, what) {
  if (typeof value !== "string") throw new BlockscoutError(`${what} is missing`, 2);
  const body = value.trim().replace(/^0x/i, "");
  if (body.includes("__$"))
    throw new BlockscoutError(`${what} has unlinked library placeholders`, 2);
  if (!/^[0-9a-fA-F]*$/.test(body) || body.length % 2)
    throw new BlockscoutError(`${what} is not hex`, 2);
  return body.toLowerCase();
}

/** ABI-encoded constructor arguments = deployed creation input minus the local creation bytecode. */
export function constructorArgs(creationInput, localBytecode, name = "contract") {
  const local = hexBody(localBytecode, `${name} artifact bytecode`);
  const remote = hexBody(creationInput, `${name} creation input`);
  if (!local) throw new BlockscoutError(`${name} artifact has no creation bytecode`, 2);
  if (!remote.startsWith(local)) {
    throw new BlockscoutError(
      `${name}: the local build differs from the deployed creation code; build the exact sources and ` +
        "foundry.toml settings that were deployed",
      2,
    );
  }
  const args = remote.slice(local.length);
  if (args.length % 64) {
    throw new BlockscoutError(`${name}: constructor arguments are not whole 32-byte words`, 2);
  }
  return `0x${args}`;
}

/** Whether a v2 smart-contract record (null = not indexed) shows the sources published as `name`. */
export function publication(record, name) {
  if (!record || typeof record !== "object")
    return { ok: false, reason: "not indexed by Blockscout yet" };
  if (record.is_verified === true && record.name === name) {
    return { ok: true, reason: `verified as ${name} (${record.compiler_version ?? "compiler ?"})` };
  }
  if (record.is_verified === true) {
    return { ok: false, reason: `verified as ${record.name ?? "?"}, expected ${name}` };
  }
  if (record.verified_twin_address_hash) {
    return {
      ok: false,
      reason:
        `not verified; Blockscout shows the unrelated twin ${record.name ?? "?"} from ` +
        `${record.verified_twin_address_hash} (this fools forge's "already verified" check)`,
    };
  }
  return { ok: false, reason: "not verified" };
}

export async function fetchRecord(url, timeoutMs = 30_000) {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new BlockscoutError(`GET ${url}: HTTP ${res.status}`, 3);
  try {
    return await res.json();
  } catch {
    throw new BlockscoutError(`GET ${url}: response is not JSON`, 3);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Calls `step` until it returns { done: true } or the deadline passes; returns the last result. */
export async function poll(step, { timeoutS, intervalS }) {
  const deadline = Date.now() + timeoutS * 1000;
  for (;;) {
    let last;
    try {
      last = await step();
    } catch (error) {
      last = { done: false, error };
    }
    if (last.done || Date.now() >= deadline) return last;
    await sleep(intervalS * 1000);
  }
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { "timeout-s": "0", "interval-s": "15" };
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i]?.replace(/^--/, "");
    if (!rest[i]?.startsWith("--") || rest[i + 1] === undefined) {
      throw new BlockscoutError(`bad argument: ${rest[i]}`, 64);
    }
    opts[k] = rest[i + 1];
  }
  for (const k of ["timeout-s", "interval-s"]) {
    const n = Number(opts[k]);
    if (!Number.isFinite(n) || n < 0) throw new BlockscoutError(`--${k} must be a number >= 0`, 64);
    opts[k] = n;
  }
  return { cmd, opts };
}

function need(opts, ...keys) {
  for (const k of keys) if (!opts[k]) throw new BlockscoutError(`missing --${k}`, 64);
}

export async function main(argv) {
  const { cmd, opts } = parseArgs(argv);
  const timing = { timeoutS: opts["timeout-s"], intervalS: opts["interval-s"] };
  if (cmd === "ctor-args") {
    need(opts, "api", "address", "artifact");
    const url = contractUrl(opts.api, opts.address);
    let artifact;
    try {
      artifact = JSON.parse(readFileSync(opts.artifact, "utf8"));
    } catch (e) {
      throw new BlockscoutError(`cannot read artifact ${opts.artifact}: ${e.message}`, 2);
    }
    const name = opts.artifact.replace(/^.*\//, "").replace(/\.json$/, "");
    const r = await poll(async () => {
      const rec = await fetchRecord(url);
      const creation = rec?.creation_bytecode;
      return {
        done: typeof creation === "string" && creation.replace(/^0x/i, "").length > 0,
        creation,
      };
    }, timing);
    if (!r.done) {
      const why = r.error ? r.error.message : "no creation input indexed";
      throw new BlockscoutError(
        `${name} ${opts.address}: ${why} after ${timing.timeoutS} s (${url})`,
        3,
      );
    }
    process.stdout.write(`${constructorArgs(r.creation, artifact?.bytecode?.object, name)}\n`);
    return 0;
  }
  if (cmd === "status") {
    need(opts, "api", "address", "name");
    const url = contractUrl(opts.api, opts.address);
    const r = await poll(async () => {
      const p = publication(await fetchRecord(url), opts.name);
      return { done: p.ok, ...p };
    }, timing);
    if (!r.done) {
      const why = r.error ? r.error.message : r.reason;
      throw new BlockscoutError(`${opts.name} ${opts.address}: ${why} (${url})`, r.error ? 3 : 1);
    }
    process.stderr.write(`${opts.name} ${opts.address}: ${r.reason}\n`);
    return 0;
  }
  throw new BlockscoutError(
    `usage: blockscout.mjs ctor-args|status --api <url> --address <0x…> …`,
    64,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`blockscout: ${e.message}\n`);
      process.exit(e instanceof BlockscoutError ? e.code : 1);
    },
  );
}
