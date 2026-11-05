import type { PieceCID } from "@filoz/synapse-core/piece";
import type { Address, Hex } from "viem";

export type { PieceCID };

/** Data set A (CDN-enabled, primary) and B (second provider, no CDN). */
export type DataSetRole = "A" | "B";
export const DATA_SET_ROLES: readonly DataSetRole[] = ["A", "B"] as const;

export type FocChainId = 314 | 314159;

export type DataSetPin = { id: bigint; providerId: bigint; withCDN: boolean };

export type FocConfig = {
  chainId: FocChainId;
  rpcUrl: string;
  payerAddress: Address;
  source: "stamper";
  dataSets: Record<DataSetRole, DataSetPin>;
};

export type PieceMetadataInput = {
  /** Stamp code: 9 Crockford base32 symbols, optionally hyphenated XXXX-XXXX-X. */
  stamp: string;
  role: "original";
  /** sha256 of the original bytes, 64 lowercase hex chars (no 0x). */
  sha256: string;
};

export type CommitPiece = { pieceCid: PieceCID; metadata: PieceMetadataInput };
/** txHash is null when every piece was already in the data set (an idempotent retry). */
export type CommitResult = { txHash: Hex | null; pieceIds: bigint[]; dataSetId: bigint };

export type RetrievalUrls = {
  filbeam: string | null;
  providers: Array<{ providerId: bigint; url: string }>;
};

export type PieceStatus = {
  dataSetLastProven: Date | null;
  dataSetNextProofDue: Date | null;
  retrievalUrl: string | null;
  pieceId?: bigint;
  inChallengeWindow?: boolean;
  isProofOverdue?: boolean;
};

export type DataSetHealth = {
  dataSetId: bigint;
  live: boolean;
  listenerIsFwss: boolean;
  lastProvenEpoch: bigint;
  nextChallengeEpoch: bigint;
  provenThisPeriod: boolean | null;
  provingDeadline: bigint | null;
  pdpEndEpoch: bigint | null;
  lifecycleReserve: bigint | null;
  providerId: bigint;
  viewOk: boolean;
};

export type PriceList = {
  perTiBPerMonthNoCdn: bigint;
  perTiBPerMonthCdn: bigint;
  perDataSetPerMonth: bigint;
  dataSetCreation: bigint;
  addPiecesFlat: bigint;
  addPiecesPerPiece: bigint;
};

export type StoreOpts = { signal?: AbortSignal; onProgress?: (n: number) => void };

export interface FocReader {
  /** Upload bytes to the data set's provider (off-chain). The SP must confirm `pieceCid`. */
  storeOriginal(
    ds: DataSetRole,
    data: Uint8Array | ReadableStream<Uint8Array>,
    pieceCid: PieceCID,
    opts?: StoreOpts,
  ): Promise<{ pieceCid: PieceCID; size: number }>;
  pieceStatus(ds: DataSetRole, pieceCid: PieceCID): Promise<PieceStatus | null>;
  retrievalUrls(pieceCid: PieceCID): Promise<RetrievalUrls>;
  providerServiceUrl(providerId: bigint): Promise<string>;
  dataSetHealth(ds: DataSetRole): Promise<DataSetHealth>;
  priceList(): Promise<PriceList>;
}

export type PreflightResult = {
  ok: boolean;
  allowanceOk: boolean;
  fundsOk: boolean;
  details: unknown;
};

export type Runway = {
  fundedUntilEpoch: bigint | null;
  days: number | null;
  availableUsdfc: bigint;
  lockupUsdfc: bigint;
};

export interface FocCustodian extends FocReader {
  /** On-chain addPieces into the pinned data set. Never creates a data set. */
  commitPieces(ds: DataSetRole, pieces: CommitPiece[]): Promise<CommitResult>;
  preflight(pieceSizes: number[]): Promise<PreflightResult>;
  runway(): Promise<Runway>;
  sessionExpiry(): Promise<{ expiresAt: Date; secondsLeft: number }>;
}

export class FocError extends Error {
  constructor(
    public readonly code:
      | "config"
      | "metadata"
      | "pin"
      | "cid_mismatch"
      | "session_key"
      | "not_found"
      | "provider",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "FocError";
  }
}
