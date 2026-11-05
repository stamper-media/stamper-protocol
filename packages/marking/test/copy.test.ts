import { containsBannedWord } from "@stamper/core";
import { describe, expect, it } from "vitest";
import { BADGE_COPY, SHARE_COPY } from "../src/index.js";

describe("user-facing copy", () => {
  it("contains no banned word", () => {
    for (const s of [...Object.values(BADGE_COPY), ...Object.values(SHARE_COPY)]) {
      expect(containsBannedWord(s)).toBeNull();
    }
  });
});
