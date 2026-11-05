import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import type { Hex } from "viem";

/** Bundled asset paths. Resolved relative to this module so they work from src/ (tests) and dist/. */
export const FONT_PATH = fileURLToPath(
  new URL("../assets/fonts/JetBrainsMono-Bold.ttf", import.meta.url),
);
export const GLYPH_PATH = fileURLToPath(new URL("../assets/glyph.svg", import.meta.url));

export type LoadedAssets = {
  font: opentype.Font;
  fontSha256: Hex;
  glyphSha256: Hex;
  /** Path data of the Stamper glyph in a 100×100 box. */
  glyphPathD: string;
  /** Glyph index substitutions of the font's `zero` feature (slashed zero). */
  zeroSubst: Map<number, number>;
};

let cached: LoadedAssets | undefined;

export function sha256Hex(bytes: Uint8Array): Hex {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

function zeroFeature(font: opentype.Font): Map<number, number> {
  const out = new Map<number, number>();
  // biome-ignore lint/suspicious/noExplicitAny: opentype's GSUB table is untyped
  const gsub = (font.tables as any).gsub;
  if (!gsub) return out;
  for (const f of gsub.features ?? []) {
    if (f.tag !== "zero") continue;
    for (const li of f.feature.lookupListIndexes ?? []) {
      const lookup = gsub.lookups[li];
      if (lookup?.lookupType !== 1) continue;
      for (const st of lookup.subtables ?? []) {
        const glyphs: number[] = st.coverage?.glyphs ?? [];
        glyphs.forEach((g, i) => {
          if (st.substFormat === 1) out.set(g, g + st.deltaGlyphId);
          else if (st.substFormat === 2 && st.substitute?.[i] !== undefined)
            out.set(g, st.substitute[i]);
        });
      }
    }
  }
  return out;
}

export function loadAssets(): LoadedAssets {
  if (cached) return cached;
  const fontBytes = readFileSync(FONT_PATH);
  const glyphBytes = readFileSync(GLYPH_PATH);
  const ab = fontBytes.buffer.slice(
    fontBytes.byteOffset,
    fontBytes.byteOffset + fontBytes.byteLength,
  );
  const font = opentype.parse(ab);
  const m = /\sd="([^"]+)"/.exec(glyphBytes.toString("utf8"));
  if (!m?.[1]) throw new Error(`glyph asset has no path data: ${GLYPH_PATH}`);
  cached = {
    font,
    fontSha256: sha256Hex(fontBytes),
    glyphSha256: sha256Hex(glyphBytes),
    glyphPathD: m[1],
    zeroSubst: zeroFeature(font),
  };
  return cached;
}
