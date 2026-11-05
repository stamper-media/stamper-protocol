import { describe, expect, it } from "vitest";
import { DEFAULT_ORIGIN } from "../src/constants.js";
import { parsePieceCid } from "../src/piece.js";
import { forensicQrPayload, parseVerifyPath, qrPayload, verifyUrl } from "../src/url.js";
import commp from "./vectors/commpv2.json" with { type: "json" };

const QR_ALNUM = /^[0-9A-Z $%*+\-./:]+$/;

describe("verify URL and QR", () => {
  it("canonical URL", () => {
    expect(verifyUrl("5vebtvraf")).toBe(`${DEFAULT_ORIGIN}/v/5VEB-TVRA-F`);
    expect(verifyUrl("5VEB-TVRA-F", "http://localhost:1234/")).toBe(
      "http://localhost:1234/v/5VEB-TVRA-F",
    );
    expect(() => verifyUrl("5VEB-TVRA-G")).toThrow();
  });
  it("QR payload is 33 alphanumeric characters for the default origin", () => {
    const p = qrPayload("5VEB-TVRA-F");
    expect(p).toBe(`${DEFAULT_ORIGIN.toUpperCase()}/V/5VEBTVRAF`);
    expect(p.length).toBe(33);
    expect(p).toMatch(QR_ALNUM);
  });
  it("forensic QR appends the PieceCID as an upper-case path segment", () => {
    const cid = parsePieceCid((commp.valid[4] as { text: string }).text);
    const p = forensicQrPayload("5VEBTVRAF", cid);
    expect(p).toMatch(QR_ALNUM);
    expect(p).toContain("/C/BAFKZCIB");
    expect(p.length).toBeLessThanOrEqual(108);
  });
  it("parseVerifyPath is case- and hyphen-insensitive", () => {
    expect(parseVerifyPath("/v/5VEB-TVRA-F")).toBe("5VEBTVRAF");
    expect(parseVerifyPath("/V/5vebtvraf")).toBe("5VEBTVRAF");
    expect(parseVerifyPath("HTTPS://STAMPER.MEDIA/V/5VEBTVRAF/C/BAFKZCIBXYZ")).toBe("5VEBTVRAF");
    expect(parseVerifyPath("/v/5VEB-TVRA-F?x=1")).toBe("5VEBTVRAF");
    expect(parseVerifyPath("/v/5VEB-TVRA-G")).toBeNull();
    expect(parseVerifyPath("/x/5VEB-TVRA-F")).toBeNull();
    expect(parseVerifyPath("/v/%ZZ")).toBeNull();
  });
});
