import type { FilecoinChain } from "@filoz/synapse-core/chains";
import { createPieceUrlFilBeam, createPieceUrlPDP } from "@filoz/synapse-core/piece";
import type { Address } from "viem";
import {
  DATA_SET_ROLES,
  type DataSetPin,
  type DataSetRole,
  FocError,
  type RetrievalUrls,
} from "./types.js";

type CidLike = { toString(): string };

/** FilBeam (CDN) URL pattern: https://{payer}.{chain.filbeam.retrievalDomain}/{cid}. Null if the chain has no FilBeam. */
export function filbeamPieceUrl(chain: FilecoinChain, payer: Address, cid: CidLike): string | null {
  if (chain.filbeam == null) return null;
  return createPieceUrlFilBeam({
    cid: cid.toString(),
    address: payer.toLowerCase() as Address,
    retrievalDomain: chain.filbeam.retrievalDomain,
  });
}

/** Provider retrieval URL: serviceURL + /piece/{cid}. Keeps any path prefix of serviceURL. */
export function providerPieceUrl(serviceURL: string, cid: CidLike): string {
  let base: URL;
  try {
    base = new URL(serviceURL);
  } catch (cause) {
    throw new FocError("provider", `invalid provider serviceURL ${serviceURL}`, { cause });
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new FocError("provider", `unsupported serviceURL protocol ${base.protocol}`);
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return createPieceUrlPDP({ cid: cid.toString(), serviceURL: base.toString() });
}

/** The subset of SPRegistryService used here (stubbable in tests). */
export interface ProviderRegistry {
  getProvider(o: { providerId: bigint }): Promise<{ pdp: { serviceURL: string } } | null>;
}

/** Resolves provider ids to serviceURLs through the SP registry, with a TTL cache. */
export class ProviderUrlResolver {
  private readonly cache = new Map<bigint, { url: string; at: number }>();
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  async serviceUrl(providerId: bigint): Promise<string> {
    const hit = this.cache.get(providerId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.url;
    const p = await this.registry.getProvider({ providerId });
    const url = p?.pdp?.serviceURL;
    if (!url)
      throw new FocError("provider", `provider ${providerId} not found or has no PDP serviceURL`);
    this.cache.set(providerId, { url, at: Date.now() });
    return url;
  }
}

/** FilBeam only for CDN-enabled sets; one provider URL per distinct provider of A and B. */
export async function buildRetrievalUrls(args: {
  chain: FilecoinChain;
  payer: Address;
  dataSets: Record<DataSetRole, DataSetPin>;
  resolver: { serviceUrl(id: bigint): Promise<string> };
  pieceCid: CidLike;
}): Promise<RetrievalUrls> {
  const { chain, payer, dataSets, resolver, pieceCid } = args;
  const anyCdn = DATA_SET_ROLES.some((r) => dataSets[r].withCDN);
  const filbeam = anyCdn ? filbeamPieceUrl(chain, payer, pieceCid) : null;
  const ids = [...new Set(DATA_SET_ROLES.map((r) => dataSets[r].providerId))];
  const providers = await Promise.all(
    ids.map(async (providerId) => ({
      providerId,
      url: providerPieceUrl(await resolver.serviceUrl(providerId), pieceCid),
    })),
  );
  return { filbeam, providers };
}
