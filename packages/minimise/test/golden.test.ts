import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectJpeg, minimiseJpeg, minimiseMp4 } from "../src/index.js";
import { FIXTURES, fixture, JPEGS, sha256, VIDEOS } from "./helpers.js";

// Committed sha256 of every fixture and of its minimised output. Regenerate (only after an
// intentional change of fixtures or output format) with: UPDATE_GOLDEN=1 pnpm test
const GOLDEN_PATH = join(FIXTURES, "golden.json");
type Golden = Record<string, { input: string; output: string }>;

function compute(): Golden {
  const g: Golden = {};
  for (const n of JPEGS)
    g[n] = { input: sha256(fixture(n)), output: sha256(minimiseJpeg(fixture(n)).bytes) };
  for (const n of VIDEOS)
    g[n] = { input: sha256(fixture(n)), output: sha256(minimiseMp4(fixture(n)).bytes) };
  return g;
}

if (process.env.UPDATE_GOLDEN === "1")
  writeFileSync(GOLDEN_PATH, `${JSON.stringify(compute(), null, 2)}\n`);
const golden: Golden = existsSync(GOLDEN_PATH) ? JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) : {};

describe("golden", () => {
  it("both-platforms", () => {
    for (const name of ["iphone.jpg", "pixel.jpg"]) {
      const input = fixture(name);
      expect(sha256(input), `${name} fixture changed`).toBe(golden[name]?.input);
      const { bytes } = minimiseJpeg(input);
      expect(sha256(bytes), `${name} output hash`).toBe(golden[name]?.output);
      expect(inspectJpeg(bytes)).toMatchObject({
        hasGps: false,
        hasSerial: false,
        hasMakerNote: false,
        hasXmp: false,
        orientation: inspectJpeg(input).orientation,
      });
    }
  });

  it("every fixture output is stable", () => {
    expect(compute()).toEqual(golden);
  });
});
