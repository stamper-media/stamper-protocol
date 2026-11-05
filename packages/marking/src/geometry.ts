import { DEFAULT_ORIGIN } from "@stamper/core";
import { FONT_ADVANCE_EM, FONT_CAP_EM } from "./text.js";

export type BadgeFamily = "F0" | "F1" | "F2";
export const BADGE_FAMILIES: readonly BadgeFamily[] = ["F0", "F1", "F2"];

export type BadgeGeometry = {
  shortSide: number;
  pillH: number;
  radius: number;
  margin: number;
  x: number;
  y: number;
  capHeight: number;
  fontPx: number;
  width: number;
};

/** User-facing badge copy (checked against the banned-word list in tests). */
export const BADGE_COPY = { f0Prefix: "REGISTERED UPLOAD · ", hardwareMark: "HW" } as const;

/** Formatted code length `XXXX-XXXX-X`. */
const CODE_CHARS = 11;
/** Smallest short side that still carries a legible badge. */
export const MIN_SHORT_SIDE = 160;
export const MAX_SIDE = 65_535;

export function defaultDomain(): string {
  return new URL(DEFAULT_ORIGIN).host;
}

export type BadgeSegment =
  | { kind: "glyph"; x: number; size: number }
  | { kind: "text"; x: number; text: "code" | "domain" | "hw" | "f0" };

/** Horizontal layout of a pill's content, shared by geometry (width) and the SVG renderer. */
export function badgeLayout(
  family: BadgeFamily,
  pillH: number,
  fontPx: number,
  domain: string,
): { width: number; segments: BadgeSegment[] } {
  const charW = FONT_ADVANCE_EM * fontPx;
  const pad = Math.round(0.4 * pillH);
  const gap = Math.round(0.25 * pillH);
  const glyph = Math.round(0.56 * pillH);
  const segments: BadgeSegment[] = [];
  let x = pad;
  if (family === "F0") {
    segments.push({ kind: "text", x, text: "f0" });
    x += (BADGE_COPY.f0Prefix.length + CODE_CHARS) * charW;
  } else {
    segments.push({ kind: "glyph", x, size: glyph });
    x += glyph + gap;
    if (family === "F2") {
      segments.push({ kind: "text", x, text: "hw" });
      x += BADGE_COPY.hardwareMark.length * charW + gap;
    }
    segments.push({ kind: "text", x, text: "code" });
    x += CODE_CHARS * charW + gap;
    segments.push({ kind: "text", x, text: "domain" });
    x += [...domain].length * charW;
  }
  return { width: Math.ceil(x + pad), segments };
}

function assertDim(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 1 || v > MAX_SIDE) {
    throw new RangeError(`${name} must be an integer in 1..${MAX_SIDE}`);
  }
}

/**
 * DESIGN §6.1: relative to the short side S, pill height 0.05·S (kept even so the radius is an
 * integer), radius h/2, margin 0.03·S, code cap height ≥ 0.016·S, bottom-right, inset so the badge
 * survives a central 4:5 crop.
 */
export function badgeGeometry(
  width: number,
  height: number,
  family: BadgeFamily,
  domain: string = defaultDomain(),
): BadgeGeometry {
  assertDim("width", width);
  assertDim("height", height);
  if (!BADGE_FAMILIES.includes(family))
    throw new RangeError(`unknown badge family ${String(family)}`);
  const S = Math.min(width, height);
  if (S < MIN_SHORT_SIDE)
    throw new RangeError(`short side ${S} < ${MIN_SHORT_SIDE}: too small for a badge`);
  const pillH = 2 * Math.round(0.025 * S);
  const radius = pillH / 2;
  const margin = Math.round(0.03 * S);
  const capHeight = Math.ceil(0.016 * S);
  const fontPx = Math.ceil(capHeight / FONT_CAP_EM);
  const { width: badgeW } = badgeLayout(family, pillH, fontPx, domain);
  // Central 4:5 crop: crops the sides of anything wider than 4:5, top/bottom of anything taller.
  let safeRight = width;
  let safeBottom = height;
  if (width * 5 > height * 4) {
    const cropW = Math.floor((height * 4) / 5);
    safeRight = width - Math.floor((width - cropW) / 2);
  } else {
    const cropH = Math.floor((width * 5) / 4);
    safeBottom = height - Math.floor((height - cropH) / 2);
  }
  const x = safeRight - margin - badgeW;
  const y = safeBottom - margin - pillH;
  if (x < margin || y < margin) throw new RangeError("badge does not fit inside the 4:5 safe area");
  return { shortSide: S, pillH, radius, margin, x, y, capHeight, fontPx, width: badgeW };
}
