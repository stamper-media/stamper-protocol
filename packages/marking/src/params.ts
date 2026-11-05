import { createHash } from "node:crypto";
import { encodeDagCbor } from "@stamper/core";
import sharp from "sharp";
import type { Hex } from "viem";
import { z } from "zod";
import { loadAssets } from "./assets.js";
import type { BadgeFamily, BadgeGeometry } from "./geometry.js";

export type RenderParams = {
  v: 1;
  family: BadgeFamily;
  geometry: BadgeGeometry;
  fontSha256: Hex;
  glyphSha256: Hex;
  jpeg: { quality: 92; chroma: "4:4:4"; mozjpeg: true };
  sharp: string;
  libvips: string;
  imageDigest: string;
  watermark?: {
    lib: "trustmark";
    version: string;
    variant: "Q";
    schema: "BCH_SUPER";
    strength: number;
    payload: string;
  };
  video?: { ffmpeg: string; crf: 20; preset: "medium"; overlayPng: Hex };
};

const hex32 = z.string().regex(/^0x[0-9a-f]{64}$/);
const int = z.number().int().nonnegative();
const renderParamsSchema = z.strictObject({
  v: z.literal(1),
  family: z.enum(["F0", "F1", "F2"]),
  geometry: z.strictObject({
    shortSide: int,
    pillH: int,
    radius: int,
    margin: int,
    x: int,
    y: int,
    capHeight: int,
    fontPx: int,
    width: int,
  }),
  fontSha256: hex32,
  glyphSha256: hex32,
  jpeg: z.strictObject({
    quality: z.literal(92),
    chroma: z.literal("4:4:4"),
    mozjpeg: z.literal(true),
  }),
  sharp: z.string().min(1),
  libvips: z.string().min(1),
  imageDigest: z.string().min(1).max(256),
  watermark: z
    .strictObject({
      lib: z.literal("trustmark"),
      version: z.string().min(1),
      variant: z.literal("Q"),
      schema: z.literal("BCH_SUPER"),
      strength: z.number().positive().finite(),
      payload: z.string().regex(/^\d+$/),
    })
    .optional(),
  video: z
    .strictObject({
      ffmpeg: z.string().min(1),
      crf: z.literal(20),
      preset: z.literal("medium"),
      overlayPng: hex32,
    })
    .optional(),
});

/**
 * sha256 over the canonical DAG-CBOR of the params. DAG-CBOR forbids floats here, so the watermark
 * strength is hashed as its shortest decimal string (1 → "1", 0.8 → "0.8").
 */
export function paramsHash(p: RenderParams): Hex {
  const parsed = renderParamsSchema.parse(p);
  const normalised = parsed.watermark
    ? { ...parsed, watermark: { ...parsed.watermark, strength: String(parsed.watermark.strength) } }
    : parsed;
  return `0x${createHash("sha256").update(encodeDagCbor(normalised)).digest("hex")}`;
}

export function rendererVersions(): { sharp: string; libvips: string } {
  const v = sharp.versions as Record<string, string | undefined>;
  return { sharp: v.sharp ?? "unknown", libvips: v.vips ?? "unknown" };
}

export function baseParams(
  family: BadgeFamily,
  geometry: BadgeGeometry,
  imageDigest: string,
): RenderParams {
  const a = loadAssets();
  return {
    v: 1,
    family,
    geometry,
    fontSha256: a.fontSha256,
    glyphSha256: a.glyphSha256,
    jpeg: { quality: 92, chroma: "4:4:4", mozjpeg: true },
    ...rendererVersions(),
    imageDigest,
  };
}
