import { calibration, mainnet } from "@filoz/synapse-core/chains";
import * as Piece from "@filoz/synapse-core/piece";
import { describe, expect, it, vi } from "vitest";
import {
  buildRetrievalUrls,
  filbeamPieceUrl,
  ProviderUrlResolver,
  providerPieceUrl,
} from "../src/index.js";

const payer = "0x2e988A386a799F506693793c6A5AF6B54dfAaBfB";

describe("retrieval URLs", async () => {
  const cid = await Piece.calculate(new Uint8Array(200).fill(7));
  const s = cid.toString();

  it("FilBeam domain comes from the chain config", () => {
    expect(filbeamPieceUrl(mainnet, payer, cid)).toBe(
      `https://${payer.toLowerCase()}.filbeam.io/${s}`,
    );
    expect(filbeamPieceUrl(calibration, payer, cid)).toBe(
      `https://${payer.toLowerCase()}.calibration.filbeam.io/${s}`,
    );
    expect(filbeamPieceUrl({ ...calibration, filbeam: null }, payer, cid)).toBeNull();
  });

  it("provider URL keeps path prefixes", () => {
    expect(providerPieceUrl("https://sp.example.com", cid)).toBe(
      `https://sp.example.com/piece/${s}`,
    );
    expect(providerPieceUrl("https://sp.example.com/pdp", cid)).toBe(
      `https://sp.example.com/pdp/piece/${s}`,
    );
    expect(() => providerPieceUrl("ftp://x", cid)).toThrow();
    expect(() => providerPieceUrl("not a url", cid)).toThrow();
  });

  it("builds FilBeam for the CDN set and one provider URL per provider via the registry", async () => {
    const getProvider = vi.fn(async ({ providerId }: { providerId: bigint }) =>
      providerId === 9n ? null : { pdp: { serviceURL: `https://sp${providerId}.example.com/` } },
    );
    const resolver = new ProviderUrlResolver({ getProvider });
    const urls = await buildRetrievalUrls({
      chain: calibration,
      payer,
      dataSets: {
        A: { id: 1n, providerId: 3n, withCDN: true },
        B: { id: 2n, providerId: 4n, withCDN: false },
      },
      resolver,
      pieceCid: cid,
    });
    expect(urls.filbeam).toContain("calibration.filbeam.io");
    expect(urls.providers).toEqual([
      { providerId: 3n, url: `https://sp3.example.com/piece/${s}` },
      { providerId: 4n, url: `https://sp4.example.com/piece/${s}` },
    ]);
    await resolver.serviceUrl(3n);
    expect(getProvider).toHaveBeenCalledTimes(2); // cached
    await expect(resolver.serviceUrl(9n)).rejects.toThrow(/not found/);

    const noCdn = await buildRetrievalUrls({
      chain: mainnet,
      payer,
      dataSets: {
        A: { id: 1n, providerId: 3n, withCDN: false },
        B: { id: 2n, providerId: 3n, withCDN: false },
      },
      resolver,
      pieceCid: cid,
    });
    expect(noCdn.filbeam).toBeNull();
    expect(noCdn.providers).toHaveLength(1);
  });
});
