import { createHash } from "node:crypto";
import * as Piece from "@filoz/synapse-core/piece";
import type { Hex } from "viem";
import type { PieceCID } from "./types.js";

export type DownloadResult = {
  ok: boolean;
  status: number;
  bytes: number;
  sha256: Hex;
  pieceCid: string;
  ms: number;
  error?: string;
};

export type DownloadOpts = {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Abort when the body exceeds this many bytes (default 1 GiB). */
  maxBytes?: number;
  fetch?: typeof fetch;
};

const EMPTY_SHA = `0x${createHash("sha256").digest("hex")}` as Hex;

function norm(h: string): string {
  return h.toLowerCase().replace(/^0x/, "");
}

/**
 * Stream `url`, re-hashing on the fly: sha256 of the bytes and the PieceCID (CommPv2) via
 * Piece.transformStream(). ok only for HTTP 200 + both digests equal to `expect`.
 * Never throws for network/HTTP problems; they come back as ok:false with `error`.
 */
export async function downloadAndVerify(
  url: string,
  expect: { sha256: Hex; pieceCid: PieceCID | string },
  opts: DownloadOpts = {},
): Promise<DownloadResult> {
  const t0 = performance.now();
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxBytes = opts.maxBytes ?? 2 ** 30;
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (opts.signal) signals.push(opts.signal);
  const signal = AbortSignal.any(signals);
  const doFetch = opts.fetch ?? fetch;
  const hash = createHash("sha256");
  let status = 0;
  let bytes = 0;
  const fail = (error: string, sha: Hex = EMPTY_SHA, cid = ""): DownloadResult => ({
    ok: false,
    status,
    bytes,
    sha256: sha,
    pieceCid: cid,
    ms: Math.round(performance.now() - t0),
    error,
  });
  try {
    const res = await doFetch(url, { signal, redirect: "follow" });
    status = res.status;
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return fail(`HTTP ${res.status}`);
    }
    if (!res.body) return fail("empty response body");
    const cidT = Piece.transformStream();
    cidT.result.catch(() => {});
    const reader = res.body.pipeThrough(cidT.transform).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        return fail(`body exceeds ${maxBytes} bytes`);
      }
      hash.update(value);
    }
    const sha = `0x${hash.digest("hex")}` as Hex;
    const cid = (await cidT.result).toString();
    const shaOk = norm(sha) === norm(expect.sha256);
    const cidOk = cid === expect.pieceCid.toString();
    const ms = Math.round(performance.now() - t0);
    if (shaOk && cidOk) return { ok: true, status, bytes, sha256: sha, pieceCid: cid, ms };
    const error = !shaOk ? "sha256 differs from expected" : "pieceCid differs from expected";
    return { ok: false, status, bytes, sha256: sha, pieceCid: cid, ms, error };
  } catch (e) {
    const timedOut = signal.aborted && !opts.signal?.aborted;
    return fail(
      timedOut ? `timeout after ${timeoutMs} ms` : e instanceof Error ? e.message : String(e),
    );
  }
}
