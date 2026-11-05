import { describe, expect, it } from "vitest";
import {
  FocError,
  focConfigFromEnv,
  parseFocConfig,
  toPieceMetadata,
  validatePieceMetadata,
} from "../src/index.js";

const sha = "a".repeat(64);

describe("validatePieceMetadata", () => {
  it("accepts up to 3 keys within limits", () => {
    expect(() => validatePieceMetadata({ a: "1", b: "2", c: "x".repeat(96) })).not.toThrow();
    expect(() => validatePieceMetadata({ ["k".repeat(32)]: "v" })).not.toThrow();
  });
  it("rejects a 4th key", () => {
    expect(() => validatePieceMetadata({ a: "1", b: "2", c: "3", d: "4" })).toThrow(FocError);
  });
  it("rejects key > 32 bytes and value > 96 bytes (UTF-8 counted)", () => {
    expect(() => validatePieceMetadata({ ["k".repeat(33)]: "v" })).toThrow(/key/);
    expect(() => validatePieceMetadata({ k: "x".repeat(97) })).toThrow(/value/);
    expect(() => validatePieceMetadata({ k: "é".repeat(49) })).toThrow(/value/); // 98 bytes
  });
  it("rejects non-string values and empty keys", () => {
    expect(() => validatePieceMetadata({ k: 1 as unknown as string })).toThrow();
    expect(() => validatePieceMetadata({ "": "v" })).toThrow();
  });
});

describe("toPieceMetadata", () => {
  it("builds the 3-key on-chain object", () => {
    expect(toPieceMetadata({ stamp: "5VEB-TVRA-F", role: "original", sha256: sha })).toEqual({
      stamp: "5VEB-TVRA-F",
      role: "original",
      sha256: sha,
    });
    expect(() =>
      toPieceMetadata({ stamp: "5VEBTVRAF", role: "original", sha256: sha }),
    ).not.toThrow();
  });
  it("rejects bad stamp, role, sha", () => {
    expect(() => toPieceMetadata({ stamp: "5VEB-TVRA", role: "original", sha256: sha })).toThrow();
    expect(() =>
      toPieceMetadata({ stamp: "IVEB-TVRA-F", role: "original", sha256: sha }),
    ).toThrow();
    expect(() =>
      toPieceMetadata({ stamp: "5VEB-TVRA-F", role: "copy" as "original", sha256: sha }),
    ).toThrow();
    expect(() =>
      toPieceMetadata({ stamp: "5VEB-TVRA-F", role: "original", sha256: `0x${sha}` }),
    ).toThrow();
  });
});

describe("config", () => {
  const env = {
    FOC_CHAIN_ID: "314159",
    FOC_PAYER_ADDRESS: "0x2e988a386a799f506693793c6a5af6b54dfaabfb",
    FOC_DATASET_A_ID: "11",
    FOC_DATASET_A_PROVIDER_ID: "3",
    FOC_DATASET_B_ID: "12",
    FOC_DATASET_B_PROVIDER_ID: "4",
  };
  it("parses env with A as the CDN set and checksums the payer", () => {
    const c = focConfigFromEnv(env);
    expect(c.dataSets.A).toEqual({ id: 11n, providerId: 3n, withCDN: true });
    expect(c.dataSets.B.withCDN).toBe(false);
    expect(c.payerAddress).toBe("0x2e988A386a799F506693793c6A5AF6B54dfAaBfB");
    expect(c.rpcUrl).toMatch(/^https:\/\//);
  });
  it("never accepts an unpinned (0 / missing) data set id", () => {
    expect(() => focConfigFromEnv({ ...env, FOC_DATASET_A_ID: "0" })).toThrow(/positive id/);
    expect(() => focConfigFromEnv({ ...env, FOC_DATASET_B_ID: undefined })).toThrow(
      /FOC_DATASET_B_ID/,
    );
  });
  it("rejects unknown chains and bad addresses", () => {
    expect(() => focConfigFromEnv({ ...env, FOC_CHAIN_ID: "1" })).toThrow(FocError);
    expect(() => parseFocConfig({ ...focConfigFromEnv(env), payerAddress: "0x1234" })).toThrow(
      /invalid address/,
    );
  });
});

describe("computeRunway", async () => {
  const { computeRunway } = await import("../src/index.js");
  it("derives funded-until epoch and days from the payer account", () => {
    const r = computeRunway(
      {
        funds: 1000n,
        lockupCurrent: 100n,
        lockupRate: 1n,
        lockupLastSettledAt: 10n,
        availableFunds: 900n,
      },
      10n,
    );
    expect(r.fundedUntilEpoch).toBe(910n);
    expect(r.days).toBeCloseTo((900 * 30) / 86_400);
    expect(r.availableUsdfc).toBe(900n);
  });
  it("returns nulls when nothing streams", () => {
    const r = computeRunway(
      { funds: 5n, lockupCurrent: 0n, lockupRate: 0n, lockupLastSettledAt: 0n, availableFunds: 5n },
      1n,
    );
    expect(r).toMatchObject({ fundedUntilEpoch: null, days: null });
  });
});
