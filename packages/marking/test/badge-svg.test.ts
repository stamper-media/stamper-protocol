import { describe, expect, it } from "vitest";
import { type BadgeFamily, badgeGeometry, renderBadgeSvg } from "../src/index.js";
import { CODE9 } from "./fixtures.js";

describe("renderBadgeSvg", () => {
  it.each(["F0", "F1", "F2"] as BadgeFamily[])("%s snapshot", (family) => {
    const geometry = badgeGeometry(1080, 1350, family);
    const svg = renderBadgeSvg({ family, code9: CODE9, geometry });
    expect(svg).toMatchSnapshot();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(`width="${geometry.width}" height="${geometry.pillH}"`);
    expect(svg).not.toContain("<text");
    expect(svg).not.toMatch(/green|#0f0|#00ff00/i);
  });

  it("F0 is a plain grey pill without glyph; F1 is dark with glyph and dimmed domain", () => {
    const f0 = renderBadgeSvg({
      family: "F0",
      code9: CODE9,
      geometry: badgeGeometry(1080, 1350, "F0"),
    });
    const f1 = renderBadgeSvg({
      family: "F1",
      code9: CODE9,
      geometry: badgeGeometry(1080, 1350, "F1"),
    });
    expect(f0).toContain('fill="#595959"');
    expect(f0).not.toContain("transform=");
    expect(f1).toContain('fill-opacity="0.62"');
    expect(f1).toContain("transform=");
    expect(f1).toContain('fill-opacity="0.6"');
  });

  it("is deterministic and depends on the code", () => {
    const geometry = badgeGeometry(1080, 1350, "F1");
    const a = renderBadgeSvg({ family: "F1", code9: CODE9, geometry });
    expect(renderBadgeSvg({ family: "F1", code9: "5veb-tvra-f", geometry })).toBe(a);
    expect(renderBadgeSvg({ family: "F1", code9: "6NJ9RNXCP", geometry })).not.toBe(a);
  });

  it("rejects an invalid code", () => {
    expect(() =>
      renderBadgeSvg({
        family: "F1",
        code9: "5VEBTVRAG",
        geometry: badgeGeometry(1080, 1350, "F1"),
      }),
    ).toThrow(/invalid code/);
  });
});
