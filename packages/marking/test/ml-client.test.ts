import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMlClients, MlError, nullWatermark } from "../src/index.js";

const HASH = `${"f0".repeat(31)}01`;
let server: Server;
let base: string;
const seen: Record<string, string> = {};

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("latin1");
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const b = await body(req);
    seen[req.url ?? ""] = b;
    const send = (status: number, v: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(typeof v === "string" ? v : JSON.stringify(v));
    };
    if (req.url === "/health")
      return send(200, { ok: true, models: ["trustmark-Q"], torch_threads: 4 });
    if (req.url === "/watermark/encode") {
      res.writeHead(200, { "content-type": "image/jpeg", "x-trustmark-version": "0.9.2" });
      return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }
    if (req.url === "/watermark/decode")
      return send(200, { ok: true, payload: "1099511627775", schema: "BCH_SUPER", bits: 40 });
    if (req.url === "/pdq") return send(200, { hash: HASH, quality: 87 });
    return send(500, "boom");
  });
  // Port 0: the OS picks a free port.
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const img = new Uint8Array([1, 2, 3, 4]);

describe("createMlClients", () => {
  it("talks to the sidecar contract", async () => {
    const ml = createMlClients(base);
    expect(await ml.health()).toEqual({ ok: true, models: ["trustmark-Q"] });
    const enc = await ml.watermark.encode(img, 42n, 0.8);
    expect(enc).toEqual({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), version: "0.9.2" });
    expect(seen["/watermark/encode"]).toMatch(/name="payload"\r\n\r\n42\r\n/);
    expect(seen["/watermark/encode"]).toMatch(/name="strength"\r\n\r\n0.8\r\n/);
    expect(seen["/watermark/encode"]).toMatch(/name="image"/);
    expect(await ml.watermark.decode(img)).toEqual({
      ok: true,
      payload40: (1n << 40n) - 1n,
      schema: "BCH_SUPER",
    });
    const p = await ml.pdq.hash(img);
    expect(p.quality).toBe(87);
    expect(Buffer.from(p.bits).toString("hex")).toBe(HASH);
  });

  it("validates input and surfaces HTTP errors", async () => {
    const ml = createMlClients(base);
    await expect(ml.watermark.encode(img, 1n << 40n)).rejects.toThrow(RangeError);
    await expect(ml.watermark.encode(img, -1n)).rejects.toThrow(RangeError);
    await expect(ml.watermark.decode(new Uint8Array())).rejects.toThrow(TypeError);
    const bad = createMlClients(`${base}/nope/`);
    await expect(bad.pdq.hash(img)).rejects.toBeInstanceOf(MlError);
    expect(() => createMlClients("ftp://x")).toThrow();
  });

  it("nullWatermark is the identity", async () => {
    expect((await nullWatermark.encode(img, 5n)).bytes).toBe(img);
    expect(await nullWatermark.decode(img)).toEqual({ ok: false, payload40: null, schema: "none" });
  });
});
