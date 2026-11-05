import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Piece from "@filoz/synapse-core/piece";
import type { Hex } from "viem";
import { toPieceMetadata } from "./metadata.js";
import { providerPieceUrl } from "./retrieval.js";
import { startPieceServer } from "./sp-server.js";
import {
  type CommitPiece,
  type CommitResult,
  type DataSetHealth,
  type DataSetRole,
  type FocCustodian,
  FocError,
  type PieceCID,
  type PieceStatus,
  type PriceList,
  type RetrievalUrls,
  type StoreOpts,
} from "./types.js";

export type MockOnCommit = (
  ds: DataSetRole,
  pieceCidBytes: Uint8Array,
) => Promise<{ txHash: Hex; pieceId: bigint; dataSetId: bigint }>;

export type MockFoc = FocCustodian & { close(): Promise<void>; baseUrl: string };

/** DeployLocal creates mock sets 1 (A) and 2 (B); provider ids mirror them. */
export const MOCK_DATA_SETS: Record<DataSetRole, { id: bigint; providerId: bigint }> = {
  A: { id: 1n, providerId: 1n },
  B: { id: 2n, providerId: 2n },
};

const USDFC = 10n ** 18n;
/** Static price list mirroring the FWSS published prices (USDFC, 18 decimals). */
export const MOCK_PRICES: PriceList = {
  perTiBPerMonthNoCdn: (25n * USDFC) / 10n,
  perTiBPerMonthCdn: (25n * USDFC) / 10n,
  perDataSetPerMonth: (24n * USDFC) / 1000n,
  dataSetCreation: (25n * USDFC) / 1000n,
  addPiecesFlat: (5n * USDFC) / 10000n,
  addPiecesPerPiece: (3n * USDFC) / 10000n,
};

async function collect(
  data: Uint8Array | ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  onProgress?: (n: number) => void,
): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    onProgress?.(data.byteLength);
    return data;
  }
  const chunks: Uint8Array[] = [];
  let n = 0;
  const reader = data.getReader();
  for (;;) {
    signal?.throwIfAborted();
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.byteLength;
    onProgress?.(n);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/**
 * FOC stand-in for anvil (FOC_MODE=mock, plan §4.3): store → <dir>/<pieceCid> served at
 * http://localhost:<port>/piece/<pieceCid>; commit → onCommit(ds, cidBytes) per piece.
 */
export async function createMockFoc(opts: {
  dir: string;
  port: number;
  onCommit: MockOnCommit;
}): Promise<MockFoc> {
  if (!opts.dir) throw new FocError("config", "mock FOC needs a dir");
  await mkdir(opts.dir, { recursive: true });
  const srv = await startPieceServer({ dir: opts.dir, port: opts.port });
  const committed = new Map<string, bigint>(); // `${ds}:${cid}` → pieceId
  const pathOf = (cid: PieceCID) => join(opts.dir, cid.toString());
  const exists = async (cid: PieceCID) =>
    (await stat(pathOf(cid)).catch(() => null))?.isFile() === true;
  const pieceUrl = (cid: PieceCID) => providerPieceUrl(`${srv.baseUrl}/`, cid);

  const mock: MockFoc = {
    baseUrl: srv.baseUrl,
    close: () => srv.close(),

    async storeOriginal(_ds: DataSetRole, data, pieceCid, o: StoreOpts = {}) {
      const bytes = await collect(data, o.signal, o.onProgress);
      const actual = await Piece.calculate(bytes);
      if (!Piece.equals(actual, pieceCid)) {
        throw new FocError("cid_mismatch", `mock SP computed ${actual}, client sent ${pieceCid}`);
      }
      const tmp = `${pathOf(pieceCid)}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, pathOf(pieceCid));
      return { pieceCid, size: bytes.byteLength };
    },

    async pieceStatus(ds, pieceCid): Promise<PieceStatus | null> {
      if (!(await exists(pieceCid))) return null;
      const pieceId = committed.get(`${ds}:${pieceCid}`);
      const s: PieceStatus = {
        dataSetLastProven: null,
        dataSetNextProofDue: null,
        retrievalUrl: pieceUrl(pieceCid),
      };
      if (pieceId !== undefined) {
        s.pieceId = pieceId;
        s.inChallengeWindow = false;
        s.isProofOverdue = false;
      }
      return s;
    },

    async retrievalUrls(pieceCid): Promise<RetrievalUrls> {
      return {
        filbeam: null,
        providers: [{ providerId: MOCK_DATA_SETS.A.providerId, url: pieceUrl(pieceCid) }],
      };
    },

    async providerServiceUrl() {
      return srv.baseUrl;
    },

    async dataSetHealth(ds): Promise<DataSetHealth> {
      const pin = MOCK_DATA_SETS[ds];
      return {
        dataSetId: pin.id,
        live: true,
        listenerIsFwss: true,
        lastProvenEpoch: 0n,
        nextChallengeEpoch: 0n,
        provenThisPeriod: null,
        provingDeadline: null,
        pdpEndEpoch: 0n,
        lifecycleReserve: null,
        providerId: pin.providerId,
        viewOk: true,
      };
    },

    async priceList() {
      return { ...MOCK_PRICES };
    },

    async commitPieces(ds, pieces: CommitPiece[]): Promise<CommitResult> {
      if (!MOCK_DATA_SETS[ds]) throw new FocError("config", `unknown data set role ${String(ds)}`);
      if (pieces.length === 0)
        throw new FocError("config", "commitPieces needs at least one piece");
      for (const p of pieces) {
        toPieceMetadata(p.metadata);
        if (!(await exists(p.pieceCid))) {
          throw new FocError("not_found", `piece ${p.pieceCid} was not stored before commit`);
        }
      }
      const pieceIds: bigint[] = [];
      let txHash: Hex | null = null;
      let dataSetId = MOCK_DATA_SETS[ds].id;
      for (const p of pieces) {
        const had = committed.get(`${ds}:${p.pieceCid}`);
        if (had !== undefined) {
          pieceIds.push(had); // like the real custodian: a retry never adds a piece twice
          continue;
        }
        const r = await opts.onCommit(ds, p.pieceCid.bytes);
        committed.set(`${ds}:${p.pieceCid}`, r.pieceId);
        pieceIds.push(r.pieceId);
        txHash = r.txHash;
        dataSetId = r.dataSetId;
      }
      return { txHash, pieceIds, dataSetId };
    },

    async preflight() {
      return { ok: true, allowanceOk: true, fundsOk: true, details: { mock: true } };
    },

    async runway() {
      return { fundedUntilEpoch: null, days: null, availableUsdfc: 0n, lockupUsdfc: 0n };
    },

    async sessionExpiry() {
      const expiresAt = new Date(Date.now() + 7 * 86_400_000);
      return { expiresAt, secondsLeft: 7 * 86_400 };
    },
  };
  return mock;
}
