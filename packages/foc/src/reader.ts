import type { FilecoinChain } from "@filoz/synapse-core/chains";
import { Synapse } from "@filoz/synapse-sdk";
import type { StorageContext } from "@filoz/synapse-sdk/storage";
import { type Chain, type Client, http, type Transport } from "viem";
import { chainFor, parseFocConfig } from "./config.js";
import { readDataSetHealth } from "./health.js";
import { buildRetrievalUrls, ProviderUrlResolver } from "./retrieval.js";
import {
  type DataSetHealth,
  type DataSetPin,
  type DataSetRole,
  type FocConfig,
  FocError,
  type FocReader,
  type PieceCID,
  type PieceStatus,
  type PriceList,
  type RetrievalUrls,
  type StoreOpts,
} from "./types.js";

/**
 * Guard: a context must be bound to the pinned data set on the pinned provider. A context without
 * a dataSetId would make the next commit create a new data set, which Stamper never does.
 */
export function assertPinnedContext(
  ctx: { dataSetId: bigint | undefined; provider: { id: bigint } },
  pin: DataSetPin,
  role: DataSetRole,
): void {
  if (ctx.dataSetId === undefined || ctx.dataSetId !== pin.id) {
    throw new FocError(
      "pin",
      `data set ${role}: context resolved to ${String(ctx.dataSetId)}, expected pinned ${pin.id}`,
    );
  }
  if (ctx.provider.id !== pin.providerId) {
    throw new FocError(
      "pin",
      `data set ${role}: provider ${ctx.provider.id} differs from pinned ${pin.providerId}`,
    );
  }
}

/** Options for createContext; dataSetId is always present so no data set can be created. */
export function pinnedContextOptions(pin: DataSetPin) {
  return { dataSetId: pin.id, providerId: pin.providerId, withCDN: pin.withCDN } as const;
}

export class SynapseFocReader implements FocReader {
  protected readonly chain: FilecoinChain;
  protected readonly resolver: ProviderUrlResolver;
  private readonly contexts = new Map<DataSetRole, Promise<StorageContext>>();

  constructor(
    protected readonly synapse: Synapse,
    protected readonly cfg: FocConfig,
  ) {
    this.chain = synapse.chain;
    this.resolver = new ProviderUrlResolver(synapse.providers);
  }

  /** Pinned StorageContext for a role (cached; a failed resolution is retried next call). */
  protected context(ds: DataSetRole): Promise<StorageContext> {
    const hit = this.contexts.get(ds);
    if (hit) return hit;
    const pin = this.cfg.dataSets[ds];
    if (!pin) throw new FocError("config", `unknown data set role ${String(ds)}`);
    const p = this.synapse.storage.createContext(pinnedContextOptions(pin)).then((ctx) => {
      assertPinnedContext(ctx, pin, ds);
      return ctx;
    });
    p.catch(() => this.contexts.delete(ds));
    this.contexts.set(ds, p);
    return p;
  }

  async storeOriginal(
    ds: DataSetRole,
    data: Uint8Array | ReadableStream<Uint8Array>,
    pieceCid: PieceCID,
    opts: StoreOpts = {},
  ): Promise<{ pieceCid: PieceCID; size: number }> {
    if (!(data instanceof Uint8Array) && !(data instanceof ReadableStream)) {
      throw new FocError("config", "data must be a Uint8Array or ReadableStream");
    }
    const ctx = await this.context(ds);
    const res = await ctx.store(data, {
      pieceCid,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    });
    if (res.pieceCid.toString() !== pieceCid.toString()) {
      throw new FocError("cid_mismatch", `SP confirmed ${res.pieceCid}, expected ${pieceCid}`);
    }
    return { pieceCid: res.pieceCid, size: res.size };
  }

  async pieceStatus(ds: DataSetRole, pieceCid: PieceCID): Promise<PieceStatus | null> {
    const ctx = await this.context(ds);
    const s = await ctx.pieceStatus({ pieceCid });
    if (!s) return null;
    const out: PieceStatus = {
      dataSetLastProven: s.dataSetLastProven,
      dataSetNextProofDue: s.dataSetNextProofDue,
      retrievalUrl: s.retrievalUrl,
    };
    if (s.pieceId !== undefined) out.pieceId = s.pieceId;
    if (s.inChallengeWindow !== undefined) out.inChallengeWindow = s.inChallengeWindow;
    if (s.isProofOverdue !== undefined) out.isProofOverdue = s.isProofOverdue;
    return out;
  }

  retrievalUrls(pieceCid: PieceCID): Promise<RetrievalUrls> {
    return buildRetrievalUrls({
      chain: this.chain,
      payer: this.cfg.payerAddress,
      dataSets: this.cfg.dataSets,
      resolver: this.resolver,
      pieceCid,
    });
  }

  providerServiceUrl(providerId: bigint): Promise<string> {
    return this.resolver.serviceUrl(providerId);
  }

  async dataSetHealth(ds: DataSetRole): Promise<DataSetHealth> {
    if (!this.cfg.dataSets[ds]) throw new FocError("config", `unknown data set role ${String(ds)}`);
    return readDataSetHealth(
      this.synapse.readClient as unknown as Client<Transport, Chain>,
      this.chain,
      this.cfg.dataSets[ds],
    );
  }

  async priceList(): Promise<PriceList> {
    const info = await this.synapse.storage.getStorageInfo();
    const pl = info.pricing.priceList;
    return {
      perTiBPerMonthNoCdn: info.pricing.noCDN.perTiBPerMonth,
      perTiBPerMonthCdn: info.pricing.withCDN.perTiBPerMonth,
      perDataSetPerMonth: pl.rates.datasetFeePerMonth,
      dataSetCreation: pl.fees.createDataSetFee,
      addPiecesFlat: pl.fees.addPiecesBaseFee,
      addPiecesPerPiece: pl.fees.addPiecesPerPieceFee,
    };
  }
}

/** Signer-less reader (worker): Synapse.create({ account: payerAddress, chain, source }). */
export async function createFocReader(input: FocConfig): Promise<FocReader> {
  const cfg = parseFocConfig(input);
  const chain = chainFor(cfg.chainId);
  const synapse = Synapse.create({
    account: cfg.payerAddress,
    chain,
    transport: http(cfg.rpcUrl),
    source: cfg.source,
  });
  return new SynapseFocReader(synapse, cfg);
}
