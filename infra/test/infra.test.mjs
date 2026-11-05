// infra checks: compose (prod + dev profile), Caddy, scripts, env superset, healthcheck, deploy dry run.
// Run: node --test infra/test/*.test.mjs   (Node 22; docker, forge and anvil are optional — tests skip with a reason)
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const INFRA = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = join(INFRA, "scripts");
const has = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
const dockerOk = has("docker") && spawnSync("docker", ["compose", "version"]).status === 0;
const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", cwd: INFRA, ...opts });

const PROD_REQUIRED = {
  APP_DOMAIN: "app.example.test",
  BACKUP_S3_ENDPOINT: "s3.example.invalid",
  BACKUP_S3_BUCKET: "stamper-backup",
  BACKUP_S3_ACCESS_KEY_ID: "id",
  BACKUP_S3_SECRET_ACCESS_KEY: "secret",
};

function composeJson(file, extraArgs = [], env = {}) {
  const r = run(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.example",
      "-f",
      file,
      ...extraArgs,
      "config",
      "--format",
      "json",
    ],
    { env: { ...process.env, ...env } },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("prod compose: seven services + backup, secrets only in api", {
  skip: !dockerOk && "docker compose not available",
}, () => {
  const c = composeJson("docker-compose.yml", [], PROD_REQUIRED);
  assert.deepEqual(Object.keys(c.services).sort(), [
    "api",
    "app",
    "backup",
    "caddy",
    "ml",
    "postgres",
    "web",
    "worker",
  ]);
  const secrets = [
    "foc_session_pk",
    "play_sa_json",
    "record_wrap_key",
    "registrar_pk",
    "relayer_pk",
    "resolver_owner_pk",
  ];
  assert.deepEqual(c.services.api.secrets.map((s) => s.source).sort(), secrets);
  for (const [name, svc] of Object.entries(c.services)) {
    if (name === "api") continue;
    assert.equal(svc.secrets, undefined, `${name} must not mount secrets`);
    assert.equal(svc.env_file, undefined, `${name} must not load an env_file`);
    for (const k of Object.keys(svc.environment ?? {})) {
      assert.ok(
        !/_FILE$|_PK$|^RECORD_WRAP_KEY$|^PLAY_SA_JSON$/.test(k),
        `${name} has secret-like env ${k}`,
      );
    }
  }
  assert.equal(c.services.api.environment.ROLE, "api");
  assert.equal(c.services.worker.environment.ROLE, "worker");
  assert.equal(c.services.worker.environment.ML_URL, "http://ml:8000");
  assert.equal(c.services.ml.deploy.resources.limits.cpus, 4);
  assert.match(c.services.postgres.image, /^pgvector\/pgvector:pg17/);
  assert.match(c.services.backup.image, /^offen\/docker-volume-backup/);
  for (const v of ["staging", "cache", "models", "pg", "caddy"])
    assert.ok(c.volumes[v], `volume ${v}`);
  const published = (c.services.caddy.ports ?? []).map((p) => Number(p.published));
  assert.ok(published.includes(80) && published.includes(443));
  for (const [name, svc] of Object.entries(c.services)) {
    if (name !== "caddy") assert.equal(svc.ports, undefined, `${name} must not publish ports`);
  }
});

test("prod compose fails closed without required settings", {
  skip: !dockerOk && "docker compose not available",
}, () => {
  const r = run(
    "docker",
    ["compose", "--env-file", "/dev/null", "-f", "docker-compose.yml", "config", "-q"],
    {
      env: { PATH: process.env.PATH, HOME: process.env.HOME ?? "" },
    },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /is required/);
});

test("dev compose: profile dev, loopback-only ports, anvil block-time 1", {
  skip: !dockerOk && "docker compose not available",
}, () => {
  const c = composeJson("docker-compose.dev.yml", ["--profile", "dev"]);
  assert.deepEqual(Object.keys(c.services).sort(), ["anvil", "caddy", "ml", "mock-sp", "postgres"]);
  const banned = new Set([5432, 8545, 3000, 8000, 8080, 6379]);
  for (const [name, svc] of Object.entries(c.services)) {
    assert.deepEqual(svc.profiles, ["dev"], name);
    for (const p of svc.ports ?? []) {
      assert.equal(p.host_ip, "127.0.0.1", `${name} must bind loopback`);
      assert.ok(
        !banned.has(Number(p.published)),
        `${name} publishes default dev port ${p.published}`,
      );
    }
  }
  assert.ok(c.services.anvil.command.join(" ").includes("--block-time 1"));
  assert.equal(c.services.caddy.environment.API_UPSTREAM.split(":")[0], "host.docker.internal");
  const env = { PATH: process.env.PATH, HOME: process.env.HOME ?? "" };
  const r = run(
    "docker",
    ["compose", "--env-file", "/dev/null", "-f", "docker-compose.dev.yml", "config", "--services"],
    { env },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "", "nothing starts without the dev profile");
});

const caddyImage = dockerOk && run("docker", ["image", "inspect", "caddy:2-alpine"]).status === 0;
for (const [file, env] of [
  [
    "Caddyfile",
    ["DOMAIN=example.test", "APP_DOMAIN=app.example.test", "ACME_EMAIL=ops@example.test"],
  ],
  ["Caddyfile.dev", []],
]) {
  test(`caddy validate ${file}`, {
    skip: !caddyImage && "caddy:2-alpine image not present locally",
  }, () => {
    const args = ["run", "--rm", "--name", `stamper-wp11-caddy-${process.pid}-${file.length}`];
    for (const e of [
      ...env,
      "API_UPSTREAM=api:8080",
      "WEB_UPSTREAM=web:3000",
      "APP_UPSTREAM=app:3000",
    ])
      args.push("-e", e);
    args.push(
      "-v",
      `${join(INFRA, file)}:/etc/caddy/Caddyfile:ro`,
      "-v",
      `${join(INFRA, "caddy")}:/etc/caddy/snippets:ro`,
    );
    args.push("caddy:2-alpine", "caddy", "validate", "--config", "/etc/caddy/Caddyfile");
    const r = run("docker", args);
    assert.equal(r.status, 0, r.stderr.slice(-800));
  });
}

test("caddy routes: well-known, mirror, api and body limits", () => {
  const routes = readFileSync(join(INFRA, "caddy/routes.caddy"), "utf8");
  for (const path of [
    "/v1/uploads/*",
    "/v1/verify/upload",
    "/v1/*",
    "/.well-known/*",
    "/m/*",
    "/healthz",
    "/metrics*",
  ]) {
    assert.ok(routes.includes(`handle ${path}`), `route ${path}`);
  }
  assert.match(routes, /max_size 500MB/);
  assert.match(routes, /handle \/v1\/verify\/upload \{\s*request_body \{\s*max_size 501MB/);
  assert.match(
    readFileSync(join(INFRA, "Caddyfile"), "utf8"),
    /Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"/,
  );
  assert.match(readFileSync(join(INFRA, "Caddyfile.dev"), "utf8"), /tls internal/);
});

test("shell scripts parse (bash -n) and pass shellcheck when available", () => {
  const files = [
    "deploy-calibration.sh",
    "deploy-mainnet.sh",
    "foc-bootstrap.sh",
    "foc-session-rotate.sh",
    "rotate-session-key.sh",
    "vps-bootstrap.sh",
    "healthcheck.sh",
    "smoke.sh",
    "lib/common.sh",
  ].map((f) => join(SCRIPTS, f));
  for (const f of files) {
    const r = run("bash", ["-n", f]);
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
  const sc = process.env.SHELLCHECK ?? (has("shellcheck") ? "shellcheck" : "");
  if (sc) {
    const r = run(sc, ["-x", ...files], { cwd: SCRIPTS });
    assert.equal(r.status, 0, r.stdout.slice(0, 2000));
  } else {
    console.log("# shellcheck not installed (set SHELLCHECK=/path); bash -n only");
  }
});

test(".env.example documents every env key the code reads", () => {
  const r = run("node", [join(SCRIPTS, "check-env.mjs")]);
  assert.equal(r.status, 0, r.stderr);
  const example = readFileSync(join(INFRA, ".env.example"), "utf8");
  for (const k of ["COMPOSE_PROFILES", "DOMAIN", "ACME_EMAIL", "BACKUP_S3_BUCKET", "NTFY_URL"]) {
    assert.match(example, new RegExp(`^#?\\s*${k}=`, "m"), k);
  }
  for (const line of example.split("\n")) {
    if (/^[A-Z0-9_]*(_PK|WRAP_KEY|SECRET_ACCESS_KEY)=/.test(line))
      assert.fail(`secret has an active value: ${line}`);
  }
});

test("check-env reports a missing key", () => {
  const dir = mkdtempSync(join(tmpdir(), "stamper-wp11-"));
  try {
    const ex = join(dir, ".env.example");
    writeFileSync(ex, "# nothing\n");
    const r = run("node", [join(SCRIPTS, "check-env.mjs"), join(INFRA, ".."), ex]);
    assert.equal(r.status, 1);
    // a key this repo reads itself (DATABASE_URL lives in stamper-services, absent from CI checkouts)
    assert.match(r.stderr, /FOC_RPC_URL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("secrets templates and runbooks exist", () => {
  for (const f of [
    "README.md",
    "relayer_pk.example",
    "registrar_pk.example",
    "foc_session_pk.example",
    "resolver_owner_pk.example",
    "record_wrap_key.example",
    "play_sa.json.example",
  ]) {
    assert.ok(existsSync(join(INFRA, "secrets", f)), f);
  }
  for (const f of [
    "session-key-revoke",
    "registrar-removal",
    "repair-reupload",
    "registrar-compromise",
    "relayer-out-of-gas",
    "provider-failing",
    "fwss-upgrade",
    "takedown",
  ]) {
    assert.ok(existsSync(join(INFRA, "runbooks", `${f}.md`)), f);
  }
  assert.ok(existsSync(join(SCRIPTS, "backup-restore.md")));
});

test("healthcheck thresholds", () => {
  const dir = mkdtempSync(join(tmpdir(), "stamper-wp11-"));
  try {
    const m = join(dir, "metrics.txt");
    const env = { ...process.env, METRICS_FILE: m, NTFY_URL: "", DOMAIN: "" };
    writeFileSync(
      m,
      '# HELP x\nstamper_queue_oldest_age_seconds{queue="ingest"} 12\nstamper_runway_days 400\nstamper_probe_failures 0\n',
    );
    let r = run("bash", [join(SCRIPTS, "healthcheck.sh"), "--dry-run"], { env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^ok/);
    writeFileSync(
      m,
      'stamper_queue_oldest_age_seconds{queue="ingest"} 12\nstamper_queue_oldest_age_seconds{queue="store"} 9000\nstamper_runway_days 30\nstamper_probe_failures{set="1"} 2\nstamper_tx_latency_seconds_max 10\n',
    );
    r = run("bash", [join(SCRIPTS, "healthcheck.sh"), "--dry-run"], { env });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /queue age 9000s > 600s/);
    assert.match(r.stdout, /runway 30 d < 60 d/);
    assert.match(r.stdout, /probe failures 2 > 0/);
    assert.doesNotMatch(r.stdout, /tx latency/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vps-bootstrap --dry-run prints the plan without changing the host", {
  skip: !existsSync("/etc/os-release") && "no /etc/os-release",
}, () => {
  const r = run("bash", [join(SCRIPTS, "vps-bootstrap.sh"), "--dry-run"]);
  if (r.status !== 0 && /only Debian\/Ubuntu/.test(r.stderr)) return;
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\+ ufw allow 443\/tcp/);
  assert.match(r.stdout, /stamper-healthcheck/);
});

test("deploy-mainnet refuses a raw DEPLOYER_PK", {
  skip: !has("forge") && "forge not installed",
}, () => {
  const r = run("bash", [join(SCRIPTS, "deploy-mainnet.sh")], {
    env: {
      ...process.env,
      MAINNET_RPC_URL: "http://127.0.0.1:1",
      GOVERNOR_ADDR: `0x${"1".repeat(40)}`,
      RESOLVER_OWNER_ADDR: `0x${"2".repeat(40)}`,
      DEPLOYER_PK: `0x${"3".repeat(64)}`,
    },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /hardware wallet/);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

test("deploy-calibration --dry-run against anvil writes anvil.json + anvil.env", {
  skip: !(has("anvil") && has("forge")) && "anvil/forge not installed",
  timeout: 900_000,
}, async () => {
  const port = Number(process.env.WP11_ANVIL_PORT ?? (await freePort()));
  const anvil = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  const out = mkdtempSync(join(tmpdir(), "stamper-wp11-deploy-"));
  try {
    const rpc = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 50; i++) {
      if (run("cast", ["chain-id", "--rpc-url", rpc]).status === 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const r = await new Promise((resolve) => {
      const p = spawn(
        "bash",
        [join(SCRIPTS, "deploy-calibration.sh"), "--dry-run", "--out-dir", out],
        {
          env: { ...process.env, ANVIL_RPC_URL: rpc },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let log = "";
      p.stdout.on("data", (d) => (log += d));
      p.stderr.on("data", (d) => (log += d));
      p.on("close", (code) => resolve({ code, log }));
    });
    assert.equal(r.code, 0, r.log.slice(-2000));
    const dep = JSON.parse(readFileSync(join(out, "anvil.json"), "utf8"));
    assert.equal(dep.chainId, 31337);
    assert.match(dep.registry, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(dep.mockDataSets.length, 2);
    const env = readFileSync(join(out, "anvil.env"), "utf8");
    assert.match(env, new RegExp(`^REGISTRY_ADDRESS=${dep.registry}$`, "m"));
    assert.match(env, /^CHAIN_ID=31337$/m);
    assert.match(env, /^REORG_DEPTH=0$/m);
    assert.match(env, /^FOC_MODE=mock$/m);
    assert.match(r.log, /binder\s+0x976EA74026E726554dB657fA54763abd0C3a0aa9 active from/);
  } finally {
    anvil.kill("SIGTERM");
    rmSync(out, { recursive: true, force: true });
  }
});
