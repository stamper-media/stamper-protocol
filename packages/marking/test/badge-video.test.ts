import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyBadgeVideo, ffmpegPath, ffprobePath, probeVideo } from "../src/index.js";
import { CODE9, DIGEST, hasBinary, makeClip, topLevelBoxes } from "./fixtures.js";

const ffmpeg = ffmpegPath();
const available = (await hasBinary(ffmpeg)) && (await hasBinary(ffprobePath(ffmpeg)));

describe.skipIf(!available)(
  `applyBadgeVideo${available ? "" : " (skipped: ffmpeg/ffprobe not found)"}`,
  () => {
    let dir: string;
    let clip: string;
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "stamper-wp04-"));
      clip = join(dir, "clip-2s.mp4");
      await makeClip(ffmpeg, clip);
    });
    afterAll(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
    });

    it("overlays the badge, keeps duration and audio, writes faststart MP4", async () => {
      const out = join(dir, "out.mp4");
      const src = await probeVideo(clip);
      const r = await applyBadgeVideo(clip, out, {
        family: "F1",
        code9: CODE9,
        imageDigest: DIGEST,
      });
      expect([r.width, r.height]).toEqual([640, 360]);
      expect(Math.abs(r.durationMs - src.durationMs)).toBeLessThanOrEqual(50);
      const dst = await probeVideo(out);
      expect(dst.hasAudio).toBe(true);
      expect(dst.audioCodec).toBe(src.audioCodec);
      const boxes = topLevelBoxes(new Uint8Array(await readFile(out)));
      expect(boxes.indexOf("moov")).toBeGreaterThan(-1);
      expect(boxes.indexOf("moov")).toBeLessThan(boxes.indexOf("mdat"));
      expect(r.params.video).toMatchObject({ crf: 20, preset: "medium" });
      expect(r.params.video?.overlayPng).toMatch(/^0x[0-9a-f]{64}$/);
      expect(r.params.imageDigest).toBe(DIGEST);
    });

    it("rejects identical input and output paths", async () => {
      await expect(
        applyBadgeVideo(clip, clip, { family: "F1", code9: CODE9, imageDigest: DIGEST }),
      ).rejects.toThrow();
    });
  },
);
