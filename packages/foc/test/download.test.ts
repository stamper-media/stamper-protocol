import { createHash } from "node:crypto";
import * as Piece from "@filoz/synapse-core/piece";
import type { Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadAndVerify } from "../src/index.js";
import { listen, randomBytes } from "./helpers.js";

const good = randomBytes(300_000, 42);
const bad = randomBytes(300_000, 43);
const sha = `0x${createHash("sha256").update(good).digest("hex")}` as Hex;
let srv: Awaited<ReturnType<typeof listen>>;

beforeAll(async () => {
  srv = await listen((req, res) => {
    if (req.url === "/good") {
      res.writeHead(200);
      // chunked to exercise streaming
      res.write(good.subarray(0, 100_000));
      setTimeout(() => res.end(good.subarray(100_000)), 5);
    } else if (req.url === "/bad") res.writeHead(200).end(bad);
    else if (req.url === "/402") res.writeHead(402).end("pay");
    else if (req.url === "/slow")
      res.writeHead(200).write(good.subarray(0, 10)); // never ends
    else res.writeHead(404).end();
  });
});
afterAll(() => srv.close());

describe("downloadAndVerify", async () => {
  const cid = await Piece.calculate(good);

  it("ok for the expected bytes", async () => {
    const r = await downloadAndVerify(`${srv.url}/good`, { sha256: sha, pieceCid: cid });
    expect(r).toMatchObject({
      ok: true,
      status: 200,
      bytes: good.length,
      sha256: sha,
      pieceCid: cid.toString(),
    });
    expect(r.error).toBeUndefined();
  });
  it("not ok for different bytes", async () => {
    const r = await downloadAndVerify(`${srv.url}/bad`, { sha256: sha, pieceCid: cid });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(200);
    expect(r.error).toMatch(/sha256/);
    expect(r.sha256).not.toBe(sha);
  });
  it("reports 404 and 402", async () => {
    expect(
      await downloadAndVerify(`${srv.url}/nope`, { sha256: sha, pieceCid: cid }),
    ).toMatchObject({
      ok: false,
      status: 404,
      error: "HTTP 404",
    });
    expect((await downloadAndVerify(`${srv.url}/402`, { sha256: sha, pieceCid: cid })).status).toBe(
      402,
    );
  });
  it("times out", async () => {
    const r = await downloadAndVerify(
      `${srv.url}/slow`,
      { sha256: sha, pieceCid: cid },
      { timeoutMs: 200 },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timeout/);
  });
  it("enforces maxBytes", async () => {
    const r = await downloadAndVerify(
      `${srv.url}/good`,
      { sha256: sha, pieceCid: cid },
      { maxBytes: 1000 },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/exceeds/);
  });
});
