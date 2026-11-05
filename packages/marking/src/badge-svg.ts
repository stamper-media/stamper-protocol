import { formatCode } from "@stamper/core";
import { loadAssets } from "./assets.js";
import {
  BADGE_COPY,
  type BadgeFamily,
  type BadgeGeometry,
  badgeLayout,
  defaultDomain,
} from "./geometry.js";
import { FONT_CAP_EM, n, textPathD } from "./text.js";

const F1_FILL = 'fill="#000" fill-opacity="0.62"';
const F0_FILL = 'fill="#595959"';

/**
 * Pure SVG string of the pill (width × pillH, origin at the pill's top-left); text is converted to
 * outlines from the bundled font so rendering never depends on system fonts.
 */
export function renderBadgeSvg(opts: {
  family: BadgeFamily;
  code9: string;
  geometry: BadgeGeometry;
  domain?: string;
}): string {
  const { family, geometry: g } = opts;
  const domain = opts.domain ?? defaultDomain();
  const code = formatCode(opts.code9);
  const layout = badgeLayout(family, g.pillH, g.fontPx, domain);
  if (layout.width > g.width) throw new RangeError("badge content is wider than the geometry");
  const baseline = (g.pillH + FONT_CAP_EM * g.fontPx) / 2;
  const parts: string[] = [
    `<rect width="${g.width}" height="${g.pillH}" rx="${n(g.radius)}" ry="${n(g.radius)}" ${family === "F0" ? F0_FILL : F1_FILL}/>`,
  ];
  for (const s of layout.segments) {
    if (s.kind === "glyph") {
      const top = (g.pillH - s.size) / 2;
      parts.push(
        `<path transform="translate(${n(s.x)} ${n(top)}) scale(${n(s.size / 100)})" fill="#fff" fill-rule="evenodd" d="${loadAssets().glyphPathD}"/>`,
      );
      continue;
    }
    const text =
      s.text === "f0"
        ? BADGE_COPY.f0Prefix + code
        : s.text === "hw"
          ? BADGE_COPY.hardwareMark
          : s.text === "code"
            ? code
            : domain;
    const opacity = s.text === "domain" ? ' fill-opacity="0.6"' : "";
    parts.push(`<path fill="#fff"${opacity} d="${textPathD(text, s.x, baseline, g.fontPx)}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${g.pillH}" viewBox="0 0 ${g.width} ${g.pillH}">${parts.join("")}</svg>`;
}
