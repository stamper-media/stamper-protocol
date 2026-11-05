/**
 * The verdict ladder (DESIGN §8.1) as a pure function over injected chain reads, plus the finality and
 * effective-level helpers. Verdicts come from chain state and the caller's own re-hash only.
 */
import type { Hex } from "viem";
import { encodeCode, formatCode, normaliseCode } from "./code.js";
import { isHexOfLength } from "./encoding.js";

export type Verdict = "ORIGINAL" | "STAMPER_MARKED_COPY" | "RELATED_COMPARE" | "NOT_REGISTERED";
export type VerdictPath = "exact" | "derivative" | "code" | "watermark" | "perceptual" | "none";

export type VerifyIO = {
  firstStampOf(sha256: Hex): Promise<Hex>;
  stampByDerivativeHash(sha256: Hex): Promise<Hex>;
  stampByCode(code: bigint): Promise<Hex>;
  getStamp(stampId: Hex): Promise<{ contentHash: Hex; pieceCid: Hex; code: bigint } | null>;
  typedCode?: string;
  watermarkDecode?(): Promise<bigint | null>;
  perceptualSearch?(): Promise<Array<{ stampId: Hex; distance: number }>>;
};

export type Decision = {
  verdict: Verdict;
  stampId?: Hex;
  code9?: string;
  candidates?: Array<{ stampId: Hex; distance: number }>;
  path: VerdictPath;
  anomaly?: "piececid-hit-without-sha256";
};

/** PDQ candidates further than this many bits are dropped (DESIGN §8.1 step 4). */
export const PERCEPTUAL_MAX_DISTANCE = 31;

const isZero = (h: Hex) => /^0x0*$/.test(h);
const eq = (a: Hex, b: Hex) => a.toLowerCase() === b.toLowerCase();

function code9Of(code: bigint): string | undefined {
  try {
    return encodeCode(code);
  } catch {
    return undefined;
  }
}

/**
 * Runs the ladder: exact (ORIGINAL) → derivative (STAMPER_MARKED_COPY) → typed code → watermark →
 * perceptual (RELATED_COMPARE, never an auto-pick) → NOT_REGISTERED. A PieceCID equal to a stamp's while
 * sha256 found nothing is a bug: it returns NOT_REGISTERED with `anomaly` set so the caller alerts.
 */
export async function decide(
  copy: { sha256: Hex; pieceCid?: Hex },
  io: VerifyIO,
): Promise<Decision> {
  if (!isHexOfLength(copy?.sha256, 32)) throw new TypeError("copy.sha256 must be bytes32 hex");
  const pieceAnomaly = (stampId: Hex, s: { pieceCid: Hex } | null): Decision | null =>
    copy.pieceCid && s && eq(s.pieceCid, copy.pieceCid)
      ? { verdict: "NOT_REGISTERED", path: "none", stampId, anomaly: "piececid-hit-without-sha256" }
      : null;

  // 1. EXACT
  const first = await io.firstStampOf(copy.sha256);
  if (!isZero(first)) {
    const s = await io.getStamp(first);
    if (s && eq(s.contentHash, copy.sha256)) {
      return { verdict: "ORIGINAL", path: "exact", stampId: first, code9: code9Of(s.code) };
    }
    const a = pieceAnomaly(first, s);
    if (a) return a;
  }
  const deriv = await io.stampByDerivativeHash(copy.sha256);
  if (!isZero(deriv)) {
    const s = await io.getStamp(deriv);
    if (s)
      return {
        verdict: "STAMPER_MARKED_COPY",
        path: "derivative",
        stampId: deriv,
        code9: code9Of(s.code),
      };
  }

  // 2. CODE, 3. WATERMARK
  const byCode = async (code: bigint, path: "code" | "watermark"): Promise<Decision | null> => {
    const id = await io.stampByCode(code);
    if (isZero(id)) return null;
    const s = await io.getStamp(id);
    if (!s) return null;
    return (
      pieceAnomaly(id, s) ?? {
        verdict: "RELATED_COMPARE",
        path,
        stampId: id,
        code9: code9Of(s.code),
      }
    );
  };
  if (io.typedCode !== undefined) {
    const n = normaliseCode(io.typedCode);
    if (n.ok) {
      const d = await byCode(n.value, "code");
      if (d) return d;
    }
  }
  if (io.watermarkDecode) {
    const wm = await io.watermarkDecode();
    if (wm !== null && wm !== undefined && wm >= 0n && wm < 1n << 40n) {
      const d = await byCode(wm, "watermark");
      if (d) return d;
    }
  }

  // 4. PERCEPTUAL
  if (io.perceptualSearch) {
    const found = (await io.perceptualSearch())
      .filter(
        (c) =>
          Number.isFinite(c.distance) && c.distance >= 0 && c.distance <= PERCEPTUAL_MAX_DISTANCE,
      )
      .sort((a, b) => a.distance - b.distance);
    if (found.length > 0)
      return { verdict: "RELATED_COMPARE", path: "perceptual", candidates: found };
  }

  // 5. NONE
  return { verdict: "NOT_REGISTERED", path: "none" };
}

/** Header label for a decision. Only the byte-exact outcome may say ORIGINAL. */
export function verdictLabel(verdict: Verdict, code9?: string): string {
  const code = code9 ? ` ${formatCode(code9)}` : "";
  switch (verdict) {
    case "ORIGINAL":
      return "ORIGINAL";
    case "STAMPER_MARKED_COPY":
      return `STAMPER MARKED COPY${code ? ` of${code}` : ""}`;
    case "RELATED_COMPARE":
      return `RELATED TO${code || " A STAMP"} — COMPARE`;
    default:
      return "NOT REGISTERED";
  }
}

export const SAFE_DEPTH = 30n;
export const FINAL_DEPTH = 900n;

/**
 * included → safe (≥ 30 epochs deep) → final (`finalized` tag ≥ registered epoch, or ≥ 900 epochs deep).
 */
export function finalityState(
  head: bigint,
  finalized: bigint | null,
  registered: bigint,
): "included" | "safe" | "final" {
  if (finalized !== null && finalized >= registered) return "final";
  const depth = head - registered;
  if (depth >= FINAL_DEPTH) return "final";
  if (depth >= SAFE_DEPTH) return "safe";
  return "included";
}

/** 0 when the key was revoked with `effectiveEpoch ≤ registeredEpoch` (revokedEpoch 0 = never revoked). */
export function effectiveLevel(
  stamp: { level: number; registeredEpoch: bigint },
  key: { revokedEpoch: bigint },
): number {
  if (key.revokedEpoch > 0n && key.revokedEpoch <= stamp.registeredEpoch) return 0;
  return stamp.level;
}
