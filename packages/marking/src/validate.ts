import { normaliseCode } from "@stamper/core";
import { BADGE_FAMILIES, type BadgeFamily } from "./geometry.js";

export function checkBadgeOpts(o: {
  family: BadgeFamily;
  code9: string;
  imageDigest: string;
}): string {
  if (!BADGE_FAMILIES.includes(o.family))
    throw new RangeError(`unknown badge family ${String(o.family)}`);
  const c = normaliseCode(o.code9);
  if (!c.ok) throw new RangeError(`invalid code (${c.reason})`);
  if (
    typeof o.imageDigest !== "string" ||
    o.imageDigest.length === 0 ||
    o.imageDigest.length > 256
  ) {
    throw new RangeError("imageDigest must be a non-empty string");
  }
  return c.code9;
}

export function checkBytes(name: string, b: unknown): asserts b is Uint8Array {
  if (!(b instanceof Uint8Array) || b.byteLength === 0)
    throw new TypeError(`${name} must be non-empty bytes`);
}
