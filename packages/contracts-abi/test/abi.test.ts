import { type AbiFunction, decodeFunctionData, toFunctionSelector, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  type CaptureClaimStruct,
  deploymentFor,
  deployments,
  encodeBindStorage,
  encodeRegisterStamp,
  encodeSetFlag,
  fwssAbi,
  fwssStateViewAbi,
  parseDeployment,
  pdpVerifierAbi,
  ResolverFlag,
  stampRegistryAbi,
  stampResolverAbi,
} from "../src/index.js";

function selectors(abi: readonly unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of abi as AbiFunction[]) {
    if (item.type === "function") out[item.name] = toFunctionSelector(item);
  }
  return out;
}

// Selectors printed in DESIGN §4.1: the ABI must match the normative interface byte for byte.
const DESIGN_SELECTORS: [readonly unknown[], Record<string, string>][] = [
  [
    stampRegistryAbi,
    {
      stampByCode: "0x06315c72",
      firstStampOf: "0xba9ee7dd",
      stampByDerivativeHash: "0xd2b5ef39",
      addRegistrar: "0xaf92a693",
      removeRegistrar: "0xba904eed",
      registerKey: "0x1398790b",
      revokeKey: "0xa2ef6acc",
      registerStamp: "0x2f6b5cda",
      attachDerivative: "0x0ccc0cbe",
      bindStorage: "0x7fbbe178",
      hashClaim: "0x262816bb",
      predictCode: "0xb0a42028",
      verifyClaim: "0xee87517c",
      getStamp: "0xd0eca23d",
      getKey: "0x12aaac70",
      getBindings: "0x0d1fcab4",
      getDerivatives: "0xe519a798",
      bindingStatus: "0x10a4b0be",
      effectiveLevel: "0x1b020b5f",
    },
  ],
  [
    pdpVerifierAbi,
    {
      dataSetLive: "0xca759f27",
      pieceLive: "0x1a271225",
      getPieceCid: "0x25bbbedf",
      findPieceIdsByCid: "0x6a4991a1",
      getDataSetListener: "0x2b3129bb",
      getDataSetStorageProvider: "0x21b7cd1c",
      getDataSetLastProvenEpoch: "0x04595c1a",
      getNextChallengeEpoch: "0x6ba4608f",
    },
  ],
  [fwssAbi, { viewContractAddress: "0x7a9ebc15" }],
  [
    fwssStateViewAbi,
    { getDataSet: "0xbdaac056", provenThisPeriod: "0x7598a1cd", provingDeadline: "0x149ac5cc" },
  ],
];

const claim: CaptureClaimStruct = {
  contentHash: `0x${"11".repeat(32)}`,
  pieceCid: `0x0155912022000a${"22".repeat(32)}`,
  contentLength: 1234n,
  mediaKind: 1,
  capturedAt: 1_700_000_000_000n,
  recordHash: `0x${"33".repeat(32)}`,
  keyId: `0x${"00".repeat(12)}${"44".repeat(20)}`,
  nonce: 7n,
  flags: 0,
  deadline: 1_700_003_600n,
};

describe("ABI", () => {
  it("matches every selector of DESIGN §4.1", () => {
    for (const [abi, want] of DESIGN_SELECTORS) {
      const got = selectors(abi);
      for (const [name, sel] of Object.entries(want)) expect(got[name], name).toBe(sel);
    }
  });

  it("exposes the added role views and resolver functions", () => {
    const reg = selectors(stampRegistryAbi);
    expect(reg.isActiveRegistrar).toBeDefined();
    expect(reg.isActiveBinder).toBeDefined();
    expect(selectors(stampResolverAbi).setFlag).toBeDefined();
  });
});

describe("encoders", () => {
  it("round-trips registerStamp", () => {
    const countersig = `0x01${"ab".repeat(65)}` as const;
    const data = encodeRegisterStamp({
      claim,
      sig: `0x${"cd".repeat(65)}`,
      authData: "0x",
      countersig,
    });
    const d = decodeFunctionData({ abi: stampRegistryAbi, data });
    expect(d.functionName).toBe("registerStamp");
    expect(d.args?.[0]).toEqual(claim);
    expect(d.args?.[3]).toBe(countersig);
  });

  it("rejects malformed inputs", () => {
    expect(() =>
      encodeRegisterStamp({ claim, sig: "0x", authData: "0x", countersig: "0x01" }),
    ).toThrow(/66 bytes/);
    expect(() =>
      encodeRegisterStamp({
        claim: { ...claim, pieceCid: "0x" },
        sig: "0x",
        authData: "0x",
        countersig: "0x",
      }),
    ).toThrow();
    expect(() => encodeBindStorage({ stampId: `0x${"00".repeat(32)}`, bindings: [] })).toThrow();
    expect(() =>
      encodeSetFlag({ stampId: `0x${"01".repeat(32)}`, flag: 9 as ResolverFlag, reasonUri: "" }),
    ).toThrow();
  });

  it("encodes resolver flags", () => {
    const data = encodeSetFlag({
      stampId: `0x${"01".repeat(32)}`,
      flag: ResolverFlag.Disputed,
      reasonUri: "r",
    });
    const d = decodeFunctionData({ abi: stampResolverAbi, data });
    expect(d.args?.[1]).toBe(3);
  });
});

describe("deployments", () => {
  it("has FOC placeholders for Calibration and mainnet that refuse use until deployed", () => {
    expect(deployments[314159]?.pdpVerifier).toBe("0x85e366Cf9DD2c0aE37E963d9556F5f4718d6417C");
    expect(deployments[314]?.fwss).toBe("0x8408502033C418E1bbC97cE9ac48E5528F371A9f");
    if (deployments[314]?.registry === zeroAddress)
      expect(() => deploymentFor(314)).toThrow(/not deployed/);
    expect(() => deploymentFor(1)).toThrow(/no Stamper deployment/);
  });

  it("parses the anvil deployment written by DeployLocal", () => {
    const d = deploymentFor(31337);
    expect(d.mockDataSets?.map((m) => m.id)).toEqual([1, 2]);
    expect(d.registrars.length).toBe(1);
  });

  it("validates deployment JSON", () => {
    expect(() => parseDeployment({ chainId: 1 })).toThrow(/chainId/);
    expect(() => parseDeployment({ ...deploymentFor(31337), registry: "0x12" })).toThrow(
      /registry/,
    );
    expect(() => parseDeployment(null)).toThrow();
  });
});
