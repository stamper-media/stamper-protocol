import * as Mocks from "@filoz/synapse-core/mocks";
import * as Piece from "@filoz/synapse-core/piece";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assertPinnedContext,
  createFocCustodian,
  createFocReader,
  type FocConfig,
  pinnedContextOptions,
} from "../src/index.js";
import { randomBytes } from "./helpers.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const cfg: FocConfig = {
  chainId: 314159,
  rpcUrl: "https://api.calibration.node.glif.io/rpc/v1",
  payerAddress: Mocks.ADDRESSES.client1,
  source: "stamper",
  dataSets: {
    A: { id: 1n, providerId: 1n, withCDN: true },
    B: { id: 1n, providerId: 1n, withCDN: false },
  },
};

/** SP stand-in: records the CID the client claims and rejects it unless it is the CID of the bytes. */
function spHandlers(base: string, seen: string[]) {
  const uploads = new Map<string, Uint8Array>();
  let n = 0;
  return [
    http.post(`${base}/pdp/piece/uploads`, () => {
      const id = `${(++n).toString(16).padStart(8, "0")}-0000-0000-0000-000000000000`;
      return new HttpResponse("Created", {
        status: 201,
        headers: { Location: `/pdp/piece/uploads/${id}` },
      });
    }),
    http.put(`${base}/pdp/piece/uploads/:id`, async ({ request, params }) => {
      uploads.set(String(params.id), new Uint8Array(await request.arrayBuffer()));
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${base}/pdp/piece/uploads/:id`, async ({ request, params }) => {
      const body = (await request.json()) as { pieceCid: string };
      seen.push(body.pieceCid);
      const bytes = uploads.get(String(params.id)) ?? new Uint8Array();
      const actual = (await Piece.calculate(bytes)).toString();
      if (actual !== body.pieceCid) return HttpResponse.text("pieceCid mismatch", { status: 400 });
      return HttpResponse.json({ pieceCid: body.pieceCid }, { status: 200 });
    }),
  ];
}

describe("reader against msw (synapse-core mocks)", () => {
  it("store() sends the precomputed CID to the SP; a mismatching CID fails", async () => {
    const seen: string[] = [];
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false }),
      Mocks.PING(),
      ...spHandlers("https://pdp.example.com", seen),
      Mocks.pdp.findAnyPieceHandler(true),
    );
    const reader = await createFocReader(cfg);
    const bytes = randomBytes(1000, 5);
    const cid = await Piece.calculate(bytes);
    const res = await reader.storeOriginal("A", bytes, cid);
    expect(res.pieceCid.toString()).toBe(cid.toString());
    expect(res.size).toBe(1000);
    expect(seen).toEqual([cid.toString()]);

    const wrong = await Piece.calculate(randomBytes(1000, 6));
    await expect(reader.storeOriginal("A", bytes, wrong)).rejects.toThrow();
  });

  it("retrieval URLs resolve the provider through the SP registry", async () => {
    server.use(Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false }));
    const reader = await createFocReader(cfg);
    const cid = await Piece.calculate(new Uint8Array(200));
    const urls = await reader.retrievalUrls(cid);
    expect(urls.filbeam).toBe(
      `https://${cfg.payerAddress.toLowerCase()}.calibration.filbeam.io/${cid}`,
    );
    expect(urls.providers).toHaveLength(1);
    expect(urls.providers[0]?.url).toMatch(new RegExp(`/piece/${cid}$`));
  });

  it("custodian refuses a session key without AddPiecesPermission", async () => {
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        debug: false,
        sessionKeyRegistry: {
          ...Mocks.presets.basic.sessionKeyRegistry,
          authorizationExpiry: () => [0n],
        },
      }),
    );
    await expect(
      createFocCustodian({ ...cfg, sessionKeyPk: Mocks.PRIVATE_KEYS.key2 }),
    ).rejects.toThrow(/lacks AddPiecesPermission/);
  });

  it("custodian refuses an expired session key", async () => {
    const past = BigInt(Math.floor(Date.now() / 1000) - 60);
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        debug: false,
        sessionKeyRegistry: {
          ...Mocks.presets.basic.sessionKeyRegistry,
          authorizationExpiry: () => [past],
        },
      }),
    );
    await expect(
      createFocCustodian({ ...cfg, sessionKeyPk: Mocks.PRIVATE_KEYS.key2 }),
    ).rejects.toThrow(/expired/);
  });
});

describe("no code path can create a data set", () => {
  const pin = { id: 7n, providerId: 3n, withCDN: false };
  it("context options always carry the pinned dataSetId", () => {
    expect(pinnedContextOptions(pin)).toEqual({ dataSetId: 7n, providerId: 3n, withCDN: false });
  });
  it("a context without (or with another) dataSetId is rejected before commit", () => {
    expect(() =>
      assertPinnedContext({ dataSetId: undefined, provider: { id: 3n } }, pin, "A"),
    ).toThrow(/pinned/);
    expect(() => assertPinnedContext({ dataSetId: 8n, provider: { id: 3n } }, pin, "A")).toThrow(
      /pinned/,
    );
    expect(() => assertPinnedContext({ dataSetId: 7n, provider: { id: 4n } }, pin, "A")).toThrow(
      /provider/,
    );
    expect(() =>
      assertPinnedContext({ dataSetId: 7n, provider: { id: 3n } }, pin, "A"),
    ).not.toThrow();
  });
});
