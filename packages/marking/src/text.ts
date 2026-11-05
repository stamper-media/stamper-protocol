import { loadAssets } from "./assets.js";

/** Advance width and cap height of the bundled monospace font, as fractions of the em. */
export const FONT_ADVANCE_EM = 0.6;
export const FONT_CAP_EM = 0.73;

/** Converts `text` to SVG path data in the bundled font (slashed zero applied). No font lookup at render time. */
export function textPathD(text: string, x: number, baseline: number, fontPx: number): string {
  const { font, zeroSubst } = loadAssets();
  const scale = fontPx / font.unitsPerEm;
  let cx = x;
  let d = "";
  for (const ch of text) {
    let glyph = font.charToGlyph(ch);
    if (glyph.index === 0)
      throw new RangeError(
        `character U+${ch.codePointAt(0)?.toString(16)} is not in the badge font`,
      );
    const alt = zeroSubst.get(glyph.index);
    if (alt !== undefined) glyph = font.glyphs.get(alt);
    d += glyph.getPath(cx, baseline, fontPx).toPathData(2);
    cx += (glyph.advanceWidth ?? font.unitsPerEm * FONT_ADVANCE_EM) * scale;
  }
  return d;
}

export function textWidth(text: string, fontPx: number): number {
  return [...text].length * FONT_ADVANCE_EM * fontPx;
}

/** Shortest decimal rendering for SVG attributes. */
export function n(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}
