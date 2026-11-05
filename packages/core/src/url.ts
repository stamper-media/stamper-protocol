/** Verify URL and QR payloads (DESIGN §3.6). The origin defaults to DEFAULT_ORIGIN. */

import { formatCode, normaliseCode } from "./code.js";
import { DEFAULT_ORIGIN } from "./constants.js";
import { type PieceCID, pieceCidString } from "./piece.js";

function canonical(code9: string): string {
  const n = normaliseCode(code9);
  if (!n.ok) throw new RangeError(`invalid code (${n.reason})`);
  return n.code9;
}

const trimOrigin = (o: string) => o.replace(/\/+$/, "");

/** `https://stamper.media/v/XXXX-XXXX-C` */
export function verifyUrl(code9: string, base: string = DEFAULT_ORIGIN): string {
  return `${trimOrigin(base)}/v/${formatCode(code9)}`;
}

/** `HTTPS://STAMPER.MEDIA/V/XXXXXXXXC`: all QR-alphanumeric (33 chars for the default origin → V2-M). */
export function qrPayload(code9: string, host: string = DEFAULT_ORIGIN): string {
  return `${trimOrigin(host)}/V/${canonical(code9)}`.toUpperCase();
}

/** Evidence-export QR: appends `/C/<PieceCID base32 upper, multibase B>` as a path segment (→ V6-Q). */
export function forensicQrPayload(
  code9: string,
  pieceCid: PieceCID,
  host: string = DEFAULT_ORIGIN,
): string {
  return `${qrPayload(code9, host)}/C/${pieceCidString(pieceCid).toUpperCase()}`;
}

/**
 * Extracts the canonical 9-symbol code from `/v/<code>` or `/v/<code>/c/<cid>` (any case, hyphens optional).
 * Accepts a full URL too. Returns null for anything else or an invalid code.
 */
export function parseVerifyPath(path: string): string | null {
  if (typeof path !== "string" || path.length > 512) return null;
  const p = path
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "")
    .replace(/[?#].*$/, "");
  const m = /^\/?v\/([^/]+)(?:\/c\/[^/]+)?\/?$/i.exec(p);
  if (!m) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(m[1] as string);
  } catch {
    return null;
  }
  const n = normaliseCode(raw);
  return n.ok ? n.code9 : null;
}
