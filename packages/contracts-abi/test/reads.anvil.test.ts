// @anvil — needs ANVIL_RPC_URL (a running anvil) and forge on PATH. Deploys with script/DeployLocal.s.sol.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Address,
  concat,
  createPublicClient,
  createTestClient,
  createWalletClient,
  type Hex,
  hashTypedData,
  http,
  pad,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type CaptureClaimStruct,
  type Deployment,
  encodeRegisterKey,
  encodeRegisterStamp,
  parseDeployment,
  readBindingStatuses,
  readPredictCode,
  readStampBundle,
  readStampByCode,
  readUsedNonce,
  stampRegistryAbi,
} from "../src/index.js";

const RPC = process.env.ANVIL_RPC_URL;
const contracts = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "contracts");
const outFile = `deployments/anvil.test-${process.pid}.json`;
// anvil's well-known dev keys #1 (registrar) and #2 (binder/relayer); DeployLocal grants them the roles.
const REGISTRAR_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const RELAYER_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

const claimTypes = {
  CaptureClaim: [
    { name: "contentHash", type: "bytes32" },
    { name: "pieceCid", type: "bytes" },
    { name: "contentLength", type: "uint64" },
    { name: "mediaKind", type: "uint8" },
    { name: "capturedAt", type: "uint64" },
    { name: "recordHash", type: "bytes32" },
    { name: "keyId", type: "bytes32" },
    { name: "nonce", type: "uint64" },
    { name: "flags", type: "uint8" },
    { name: "deadline", type: "uint64" },
  ],
} as const;
const enrolTypes = {
  KeyEnrolment: [
    { name: "keyId", type: "bytes32" },
    { name: "keyType", type: "uint8" },
    { name: "platform", type: "uint8" },
    { name: "level", type: "uint8" },
    { name: "x", type: "bytes32" },
    { name: "y", type: "bytes32" },
    { name: "addr", type: "address" },
    { name: "rpIdHash", type: "bytes32" },
    { name: "attestationHash", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;
const popTypes = {
  KeyPossession: [
    { name: "keyId", type: "bytes32" },
    { name: "keyType", type: "uint8" },
    { name: "platform", type: "uint8" },
    { name: "x", type: "bytes32" },
    { name: "y", type: "bytes32" },
    { name: "addr", type: "address" },
  ],
} as const;
const counterTypes = {
  CaptureCountersignature: [
    { name: "stampId", type: "bytes32" },
    { name: "level", type: "uint8" },
  ],
} as const;

describe.skipIf(!RPC)("contracts-abi against anvil (@anvil)", () => {
  const transport = http(RPC);
  const client = createPublicClient({ chain: foundry, transport });
  const test = createTestClient({ chain: foundry, mode: "anvil", transport });
  const registrar = privateKeyToAccount(REGISTRAR_PK);
  const relayer = createWalletClient({
    chain: foundry,
    transport,
    account: privateKeyToAccount(RELAYER_PK),
  });
  const device = privateKeyToAccount(generatePrivateKey());
  let dep: Deployment;

  beforeAll(async () => {
    execFileSync(
      "forge",
      [
        "script",
        "script/DeployLocal.s.sol",
        "--rpc-url",
        RPC as string,
        "--broadcast",
        "--skip",
        "test",
      ],
      {
        cwd: contracts,
        env: { ...process.env, DEPLOYMENTS_OUT: outFile },
        stdio: "pipe",
      },
    );
    dep = parseDeployment(JSON.parse(readFileSync(join(contracts, outFile), "utf8")));
    await test.increaseTime({ seconds: 48 * 3600 });
    await test.mine({ blocks: 1 });
  }, 300_000);

  afterAll(() => rmSync(join(contracts, outFile), { force: true }));

  it("registers a stamp and reads it back", async () => {
    const domain = {
      name: "Stamper",
      version: "1",
      chainId: 31337,
      verifyingContract: dep.registry,
    } as const;
    const now = (await client.getBlock()).timestamp;
    const keyId = pad(device.address, { size: 32 });
    const zero32 = pad("0x", { size: 32 });
    const enrolment = {
      keyId,
      keyType: 0,
      platform: 2,
      level: 1,
      x: zero32,
      y: zero32,
      addr: device.address,
      rpIdHash: zero32,
      attestationHash: pad("0x01", { size: 32 }),
      expiresAt: now + 365n * 86400n,
    } as const;
    const popSig = await device.signTypedData({
      domain,
      types: popTypes,
      primaryType: "KeyPossession",
      message: enrolment,
    });
    const endorsement = await registrar.signTypedData({
      domain,
      types: enrolTypes,
      primaryType: "KeyEnrolment",
      message: enrolment,
    });
    const keyHash = await relayer.sendTransaction({
      to: dep.registry,
      data: encodeRegisterKey({ enrolment, popSig, endorsement }),
    });
    expect((await client.waitForTransactionReceipt({ hash: keyHash })).status).toBe("success");

    const claim: CaptureClaimStruct = {
      contentHash: pad("0xc0ffee", { size: 32 }),
      pieceCid: concat(["0x0155912022000a", pad("0xbeef", { size: 32 })]),
      contentLength: 4096n,
      mediaKind: 1,
      capturedAt: now * 1000n,
      recordHash: pad("0x0dd", { size: 32 }),
      keyId,
      nonce: 42n,
      flags: 0,
      deadline: now + 3600n,
    };
    const stampId = hashTypedData({
      domain,
      types: claimTypes,
      primaryType: "CaptureClaim",
      message: claim,
    });
    expect(
      await client.readContract({
        address: dep.registry,
        abi: stampRegistryAbi,
        functionName: "hashClaim",
        args: [claim],
      }),
    ).toBe(stampId);
    const predicted = await readPredictCode(client, dep.registry, stampId);

    const sig = await device.sign({ hash: stampId });
    const cs = await registrar.signTypedData({
      domain,
      types: counterTypes,
      primaryType: "CaptureCountersignature",
      message: { stampId, level: 1 },
    });
    const countersig = concat([toHex(1, { size: 1 }), cs]);
    const hash = await relayer.sendTransaction({
      to: dep.registry,
      data: encodeRegisterStamp({ claim, sig, authData: "0x", countersig }),
    });
    expect((await client.waitForTransactionReceipt({ hash })).status).toBe("success");

    const bundle = await readStampBundle(client, dep.registry, stampId);
    expect(BigInt(bundle.stamp.code)).toBe(predicted.code);
    expect(bundle.stamp.level).toBe(1);
    expect(bundle.effectiveLevel).toBe(1);
    expect(bundle.key.registrar).toBe(registrar.address as Address);
    expect(bundle.registrarActiveFrom).toBeGreaterThan(0n);
    expect(bundle.bindings).toEqual([]);
    expect(await readStampByCode(client, dep.registry, predicted.code)).toBe(stampId);
    expect(await readUsedNonce(client, dep.registry, keyId, 42n)).toBe(true);
    expect(await readUsedNonce(client, dep.registry, keyId, 43n)).toBe(false);
    const [status] = await readBindingStatuses(client, dep.registry, stampId, [0]);
    expect(status?.dataSetLive).toBe(false);
    await expect(
      readStampBundle(client, dep.registry, pad("0x01", { size: 32 }) as Hex),
    ).rejects.toThrow(/not registered/);
  }, 120_000);
});
