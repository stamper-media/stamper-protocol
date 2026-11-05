import { z } from "zod";
import { checkBytes } from "./validate.js";

export interface WatermarkClient {
  encode(
    image: Uint8Array,
    payload40: bigint,
    strength?: number,
  ): Promise<{ bytes: Uint8Array; version: string }>;
  decode(image: Uint8Array): Promise<{ ok: boolean; payload40: bigint | null; schema: string }>;
}

export interface PdqClient {
  hash(image: Uint8Array): Promise<{ bits: Uint8Array /* 32 B */; quality: number }>;
}

export class MlError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MlError";
  }
}

export const PAYLOAD_MAX = (1n << 40n) - 1n;

/** Identity watermark used when the ml sidecar is disabled: encode returns the input, decode finds nothing. */
export const nullWatermark: WatermarkClient = {
  async encode(image) {
    checkBytes("image", image);
    return { bytes: image, version: "none" };
  },
  async decode() {
    return { ok: false, payload40: null, schema: "none" };
  },
};

const decodeSchema = z.object({
  ok: z.boolean(),
  payload: z.string().regex(/^\d+$/).nullable(),
  schema: z.string(),
});
const pdqSchema = z.object({
  hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
  quality: z.number().int(),
});
const healthSchema = z.object({ ok: z.boolean(), models: z.array(z.string()) });

export function pdqFromHex(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new RangeError("PDQ hash must be 64 hex chars");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function imageForm(image: Uint8Array, fields: Record<string, string> = {}): FormData {
  checkBytes("image", image);
  const fd = new FormData();
  fd.append("image", new Blob([new Uint8Array(image)]), "image");
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

/** HTTP clients for services/ml (TrustMark Q BCH_SUPER, PDQ). The only network access in this package. */
export function createMlClients(
  baseUrl: string,
  opts: { timeoutMs?: number } = {},
): {
  watermark: WatermarkClient;
  pdq: PdqClient;
  health(): Promise<{ ok: boolean; models: string[] }>;
} {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new RangeError("ML_URL must be http(s)");
  const base = parsed.href.replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 30_000;

  async function call(path: string, init: RequestInit): Promise<Response> {
    const url = `${base}${path}`;
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new MlError(`ml request ${path} failed: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      throw new MlError(`ml ${path} returned ${res.status}: ${body}`, res.status);
    }
    return res;
  }

  async function json<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    const res = await call(path, init);
    const parsed = schema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new MlError(`ml ${path} returned an unexpected body`);
    return parsed.data;
  }

  const watermark: WatermarkClient = {
    async encode(image, payload40, strength = 1.0) {
      if (typeof payload40 !== "bigint" || payload40 < 0n || payload40 > PAYLOAD_MAX) {
        throw new RangeError("payload must be a 40-bit unsigned bigint");
      }
      if (!Number.isFinite(strength) || strength <= 0) throw new RangeError("strength must be > 0");
      const res = await call("/watermark/encode", {
        method: "POST",
        body: imageForm(image, { payload: payload40.toString(), strength: String(strength) }),
      });
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0) throw new MlError("ml /watermark/encode returned no bytes");
      return { bytes, version: res.headers.get("x-trustmark-version") ?? "unknown" };
    },
    async decode(image) {
      const r = await json(
        "/watermark/decode",
        { method: "POST", body: imageForm(image) },
        decodeSchema,
      );
      const payload40 = r.ok && r.payload !== null ? BigInt(r.payload) : null;
      if (payload40 !== null && payload40 > PAYLOAD_MAX)
        throw new MlError("decoded payload exceeds 40 bits");
      return { ok: r.ok && payload40 !== null, payload40, schema: r.schema };
    },
  };

  const pdq: PdqClient = {
    async hash(image) {
      const r = await json("/pdq", { method: "POST", body: imageForm(image) }, pdqSchema);
      return { bits: pdqFromHex(r.hash), quality: r.quality };
    },
  };

  return {
    watermark,
    pdq,
    health: () => json("/health", { method: "GET" }, healthSchema),
  };
}
