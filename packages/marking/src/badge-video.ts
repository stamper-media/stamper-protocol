import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import sharp from "sharp";
import { sha256Hex } from "./assets.js";
import { renderBadgeSvg } from "./badge-svg.js";
import { type BadgeFamily, badgeGeometry } from "./geometry.js";
import { baseParams, type RenderParams } from "./params.js";
import { checkBadgeOpts } from "./validate.js";

export function ffmpegPath(override?: string): string {
  return override ?? process.env.FFMPEG_PATH ?? "ffmpeg";
}

export function ffprobePath(ffmpeg?: string): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  if (ffmpeg && /ffmpeg$/.test(ffmpeg)) return ffmpeg.replace(/ffmpeg$/, "ffprobe");
  return "ffprobe";
}

export type ProbeResult = {
  width: number;
  height: number;
  durationMs: number;
  hasAudio: boolean;
  audioCodec?: string;
};

type ProbeJson = {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    tags?: { rotate?: string };
    side_data_list?: Array<{ rotation?: number }>;
  }>;
  format?: { duration?: string };
};

/** Displayed video size (rotation metadata applied), duration and audio presence. */
export async function probeVideo(path: string, ffprobe = ffprobePath()): Promise<ProbeResult> {
  const { stdout } = await execa(ffprobe, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    path,
  ]);
  const j = JSON.parse(stdout) as ProbeJson;
  const v = j.streams?.find((s) => s.codec_type === "video");
  if (!v?.width || !v.height) throw new Error(`no video stream in ${path}`);
  const a = j.streams?.find((s) => s.codec_type === "audio");
  const rot = Number(
    v.tags?.rotate ?? v.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0,
  );
  const swap = Math.abs(rot) % 180 === 90;
  const dur = Number(j.format?.duration ?? Number.NaN);
  if (!Number.isFinite(dur)) throw new Error(`no duration for ${path}`);
  return {
    width: swap ? v.height : v.width,
    height: swap ? v.width : v.height,
    durationMs: Math.round(dur * 1000),
    hasAudio: a !== undefined,
    ...(a?.codec_name ? { audioCodec: a.codec_name } : {}),
  };
}

export async function ffmpegVersion(ffmpeg = ffmpegPath()): Promise<string> {
  const { stdout } = await execa(ffmpeg, ["-hide_banner", "-version"]);
  const m = /ffmpeg version (\S+)/.exec(stdout);
  return m?.[1] ?? "unknown";
}

/**
 * Burns the badge into a video with ffmpeg: pre-rendered badge PNG `overlay`, libx264 crf 20 preset
 * medium, faststart, audio copied, metadata dropped. Uses only flags common to ffmpeg 4.4 and 7.
 */
export async function applyBadgeVideo(
  inputPath: string,
  outputPath: string,
  opts: { family: BadgeFamily; code9: string; ffmpegPath?: string; imageDigest: string },
): Promise<{ params: RenderParams; durationMs: number; width: number; height: number }> {
  const code9 = checkBadgeOpts(opts);
  if (!inputPath || !outputPath || inputPath === outputPath)
    throw new RangeError("distinct input and output paths required");
  const ffmpeg = ffmpegPath(opts.ffmpegPath);
  const ffprobe = ffprobePath(ffmpeg);
  const src = await probeVideo(inputPath, ffprobe);
  const geometry = badgeGeometry(src.width, src.height, opts.family);
  const png = await sharp(Buffer.from(renderBadgeSvg({ family: opts.family, code9, geometry })))
    .png({ compressionLevel: 9 })
    .toBuffer();
  const dir = await mkdtemp(join(tmpdir(), "stamper-badge-"));
  try {
    const badgePath = join(dir, "badge.png");
    await writeFile(badgePath, png);
    await execa(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-i",
      badgePath,
      "-filter_complex",
      `[0:v][1:v]overlay=${geometry.x}:${geometry.y}[v]`,
      "-map",
      "[v]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-preset",
      "medium",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-map_metadata",
      "-1",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const out = await probeVideo(outputPath, ffprobe);
  const params: RenderParams = {
    ...baseParams(opts.family, geometry, opts.imageDigest),
    video: {
      ffmpeg: await ffmpegVersion(ffmpeg),
      crf: 20,
      preset: "medium",
      overlayPng: sha256Hex(png),
    },
  };
  return { params, durationMs: out.durationMs, width: out.width, height: out.height };
}
