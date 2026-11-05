import { describe, expect, it } from "vitest";
import { buildC2paAnchorAssertion, notImplemented, unimplementedC2paSigner } from "../src/index.js";

const h = (b: string) => `0x${b.repeat(32)}` as `0x${string}`;
const input = {
  stampId: h("11"),
  code9: "5VEBTVRAF",
  contentHash: h("22"),
  pieceCid: "bafkzcibcaapao7vk5wd7ce5vv3ldxuauklqi2zvp2fn6ctvsj7jxfd2spumpa",
  derivedHash: h("33"),
  registry: {
    chainId: 314159,
    address: "0x8408502033C418E1bbC97cE9ac48E5528F371A9f" as const,
    txHash: h("44"),
    epoch: 123456n,
  },
  level: 1,
};

describe("C2PA hooks", () => {
  it("builds the media.stamper.anchor assertion with wire encodings", () => {
    const a = buildC2paAnchorAssertion(input);
    expect(a.label).toBe("media.stamper.anchor");
    expect(a.data).toEqual({
      stampId: h("11"),
      code: "5VEBTVRAF",
      contentHash: h("22"),
      pieceCid: input.pieceCid,
      derivedHash: h("33"),
      registry: {
        chainId: 314159,
        address: input.registry.address,
        txHash: h("44"),
        epoch: "123456",
      },
      level: 1,
    });
    expect(() => JSON.stringify(a.data)).not.toThrow();
  });

  it("validates the code with its checksum and emits the canonical form", () => {
    expect(buildC2paAnchorAssertion({ ...input, code9: "5veb-tvra-f" }).data.code).toBe(
      "5VEBTVRAF",
    );
    expect(() => buildC2paAnchorAssertion({ ...input, code9: "5VEBTVRAG" })).toThrow();
    expect(() => buildC2paAnchorAssertion({ ...input, code9: "UUUUUUUUU" })).toThrow();
  });

  it("rejects malformed fields", () => {
    expect(() => buildC2paAnchorAssertion({ ...input, stampId: "0x12" })).toThrow();
    expect(() => buildC2paAnchorAssertion({ ...input, level: 3 })).toThrow();
    expect(() => buildC2paAnchorAssertion({ ...input, pieceCid: "bafy123" })).toThrow();
    expect(() =>
      buildC2paAnchorAssertion({
        ...input,
        registry: { ...input.registry, address: "0x1234" as `0x${string}` },
      }),
    ).toThrow();
  });

  it("signing is a clear v1 placeholder", async () => {
    expect(() => notImplemented()).toThrow(/not implemented/);
    await expect(unimplementedC2paSigner.sign({})).rejects.toThrow(/not implemented/);
  });
});
