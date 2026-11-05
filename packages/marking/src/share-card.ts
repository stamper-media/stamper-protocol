import { DEFAULT_ORIGIN, normaliseCode } from "@stamper/core";
import QRCode from "qrcode";
import sharp, { type OverlayOptions } from "sharp";
import { MAX_INPUT_PIXELS } from "./badge-image.js";
import { FONT_ADVANCE_EM, n, textPathD, textWidth } from "./text.js";
import { checkBytes } from "./validate.js";

export const SHARE_CARD = { width: 1080, height: 1350 } as const;
/** QR geometry: version 2 (25 modules), ECC M, 16 px per module (≥ 8 required by DESIGN §6.1). */
export const SHARE_QR = { version: 2, modules: 25, ecc: "M", modulePx: 16 } as const;
/** User-facing share-card copy (checked against the banned-word list in tests). */
export const SHARE_COPY = { footerPrefix: "verify at " } as const;

const INK = "#111111";
const MUTED = "#555555";
const PAD = 96;
const SENTENCE_PX = 38;
const SENTENCE_LINE = 52;
const SENTENCE_MAX_LINES = 6;

/** QR matrix for the payload; throws unless it encodes as version 2 / ECC M. */
export function shareQr(payload: string): {
  size: number;
  dark: (r: number, c: number) => boolean;
} {
  if (typeof payload !== "string" || payload.length === 0)
    throw new RangeError("qrPayload required");
  const qr = QRCode.create(payload, {
    version: SHARE_QR.version,
    errorCorrectionLevel: SHARE_QR.ecc,
  });
  const size = qr.modules.size;
  if (qr.version !== SHARE_QR.version || size !== SHARE_QR.modules) {
    throw new RangeError(`share-card QR must be version 2 (got ${qr.version})`);
  }
  return { size, dark: (r, c) => Boolean(qr.modules.get(r, c)) };
}

export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if ([...next].length <= maxChars) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = [...w].length > maxChars ? [...w].slice(0, maxChars).join("") : w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = [...(kept[maxLines - 1] as string)];
    kept[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
    return kept;
  }
  return lines;
}

function centred(text: string, baseline: number, px: number, fill: string): string {
  const x = (SHARE_CARD.width - textWidth(text, px)) / 2;
  return `<path fill="${fill}" d="${textPathD(text, x, baseline, px)}"/>`;
}

/** 1080×1350 PNG: large QR (V2-M), code, tier sentence, footer; optional thumbnail top-left. */
export async function renderShareCard(opts: {
  code9: string;
  tierSentence: string;
  qrPayload: string;
  thumbnail?: Uint8Array;
}): Promise<Uint8Array> {
  const c = normaliseCode(opts.code9);
  if (!c.ok) throw new RangeError(`invalid code (${c.reason})`);
  if (typeof opts.tierSentence !== "string" || !opts.tierSentence.trim())
    throw new RangeError("tierSentence required");
  const qr = shareQr(opts.qrPayload);
  const m = SHARE_QR.modulePx;
  const qrPx = qr.size * m;
  const qrX = opts.thumbnail ? SHARE_CARD.width - PAD - qrPx : (SHARE_CARD.width - qrPx) / 2;
  const qrY = PAD;
  let qrD = "";
  for (let r = 0; r < qr.size; r++)
    for (let col = 0; col < qr.size; col++)
      if (qr.dark(r, col)) qrD += `M${qrX + col * m} ${qrY + r * m}h${m}v${m}h-${m}z`;
  const code = `${c.code9.slice(0, 4)}-${c.code9.slice(4, 8)}-${c.code9.slice(8)}`;
  const maxChars = Math.floor((SHARE_CARD.width - 2 * PAD) / (FONT_ADVANCE_EM * SENTENCE_PX));
  const lines = wrapText(opts.tierSentence, maxChars, SENTENCE_MAX_LINES);
  const parts = [
    `<rect width="${SHARE_CARD.width}" height="${SHARE_CARD.height}" fill="#ffffff"/>`,
    `<path fill="#000000" d="${qrD}"/>`,
    centred(code, qrY + qrPx + 150, 80, INK),
    ...lines.map((l, i) => centred(l, qrY + qrPx + 260 + i * SENTENCE_LINE, SENTENCE_PX, INK)),
    centred(
      SHARE_COPY.footerPrefix + new URL(DEFAULT_ORIGIN).host,
      SHARE_CARD.height - 72,
      34,
      MUTED,
    ),
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_CARD.width}" height="${SHARE_CARD.height}" viewBox="0 0 ${SHARE_CARD.width} ${SHARE_CARD.height}">${parts.join("")}</svg>`;
  const composites: OverlayOptions[] = [];
  if (opts.thumbnail) {
    checkBytes("thumbnail", opts.thumbnail);
    const side = qrPx;
    const thumb = await sharp(opts.thumbnail, { limitInputPixels: MAX_INPUT_PIXELS })
      .autoOrient()
      .resize(side, side, { fit: "cover" })
      .png()
      .toBuffer();
    composites.push({ input: thumb, left: PAD, top: qrY });
  }
  const out = await sharp(Buffer.from(svg), { density: 72 })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  if (out.info.width !== SHARE_CARD.width || out.info.height !== SHARE_CARD.height) {
    throw new Error(`share card rendered at ${n(out.info.width)}x${n(out.info.height)}`);
  }
  return new Uint8Array(out.data.buffer, out.data.byteOffset, out.data.byteLength);
}
