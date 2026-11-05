import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Piece from "@filoz/synapse-core/piece";
import type { Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMockFoc, downloadAndVerify, type MockFoc } from "../src/index.js";
import { randomBytes } from "./helpers.js";

let dir: string;
let foc: MockFoc;
const onCommit = vi.fn(async (ds: "A" | "B", _cid: Uint8Array) => ({
  txHash: `0x${"ab".repeat(32)}` as Hex,
  pieceId: BigInt(onCommit.mock.calls.length - 1),
  dataSetId: ds === "A" ? 1n : 2n,
}));

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "stamper-foc-mock-"));
  foc = await createMockFoc({ dir, port: Number(process.env.MOCK_SP_PORT ?? 0), onCommit });
});
afterAll(async () => {
  await foc.close();
  await rm(dir, { recursive: true, force: true });
});

describe("MockFoc", () => {
  it("store → served → downloadAndVerify ok; commit calls onCommit", async () => {
    const bytes = randomBytes(5000, 7);
    const cid = await Piece.calculate(bytes);
    const sha = `0x${createHash("sha256").update(bytes).digest("hex")}` as Hex;
    expect(await foc.pieceStatus("A", cid)).toBeNull();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.subarray(0, 1000));
        c.enqueue(bytes.subarray(1000));
        c.close();
      },
    });
    expect(await foc.storeOriginal("A", stream, cid)).toEqual({ pieceCid: cid, size: 5000 });

    const urls = await foc.retrievalUrls(cid);
    expect(urls.filbeam).toBeNull();
    const url = urls.providers[0]?.url ?? "";
    expect(url).toBe(`${foc.baseUrl}/piece/${cid}`);
    expect((await downloadAndVerify(url, { sha256: sha, pieceCid: cid })).ok).toBe(true);
    expect((await fetch(url, { method: "HEAD" })).headers.get("content-length")).toBe("5000");

    const r = await foc.commitPieces("A", [
      { pieceCid: cid, metadata: { stamp: "5VEB-TVRA-F", role: "original", sha256: sha.slice(2) } },
    ]);
    expect(onCommit).toHaveBeenCalledWith("A", cid.bytes);
    expect(r).toEqual({ txHash: `0x${"ab".repeat(32)}`, pieceIds: [0n], dataSetId: 1n });
    expect((await foc.pieceStatus("A", cid))?.pieceId).toBe(0n);
    // a retried commit reuses the piece already in the data set instead of adding it again
    const again = await foc.commitPieces("A", [
      { pieceCid: cid, metadata: { stamp: "5VEB-TVRA-F", role: "original", sha256: sha.slice(2) } },
    ]);
    expect(again).toEqual({ txHash: null, pieceIds: [0n], dataSetId: 1n });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect((await foc.dataSetHealth("B")).live).toBe(true);
  });

  it("rejects a CID that does not belong to the bytes, and commits of unstored pieces", async () => {
    const a = randomBytes(300, 1);
    const otherCid = await Piece.calculate(randomBytes(300, 2));
    await expect(foc.storeOriginal("B", a, otherCid)).rejects.toThrow(/computed/);
    await expect(
      foc.commitPieces("B", [
        {
          pieceCid: otherCid,
          metadata: { stamp: "5VEB-TVRA-F", role: "original", sha256: "0".repeat(64) },
        },
      ]),
    ).rejects.toThrow(/not stored/);
  });

  it("serves only canonical piece CIDs (no traversal)", async () => {
    expect((await fetch(`${foc.baseUrl}/piece/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await fetch(`${foc.baseUrl}/piece/bafy`)).status).toBe(404);
    expect((await fetch(`${foc.baseUrl}/piece/x`, { method: "POST" })).status).toBe(405);
  });
});
