// Rank approved PDP providers by HEAD latency on their /piece/ endpoint.
// Usage: FOC_CHAIN_ID=314159 FOC_PAYER_ADDRESS=0x… pnpm tsx scripts/select-providers.ts
import * as Piece from "@filoz/synapse-core/piece";
import { providerPieceUrl } from "../src/retrieval.js";
import { readOnly } from "./_common.js";

const { synapse } = readOnly();
const info = await synapse.storage.getStorageInfo();
const probe = await Piece.calculate(new Uint8Array(127));
const rows = await Promise.all(
  info.providers.map(async (p) => {
    const url = providerPieceUrl(p.pdp.serviceURL, probe);
    const t0 = performance.now();
    let status = 0;
    try {
      status = (await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) })).status;
    } catch {
      status = -1;
    }
    return {
      id: p.id,
      name: p.name,
      serviceURL: p.pdp.serviceURL,
      location: p.pdp.location,
      status,
      ms: Math.round(performance.now() - t0),
    };
  }),
);
rows.sort((a, b) => (a.status === -1 ? 1 : 0) - (b.status === -1 ? 1 : 0) || a.ms - b.ms);
console.table(rows.map((r) => ({ ...r, id: r.id.toString() })));
