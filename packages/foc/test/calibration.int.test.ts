// Week-1 store/commit split spike (DESIGN §5.2) on Filecoin Calibration. Needs a funded payer with
// data sets A/B and an AddPieces session key; skipped with a visible reason otherwise.
import { createHash } from "node:crypto";
import * as Piece from "@filoz/synapse-core/piece";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  createFocCustodian,
  createFocReader,
  type DataSetRole,
  downloadAndVerify,
  focConfigFromEnv,
} from "../src/index.js";

const REQUIRED = [
  "FOC_SESSION_PK",
  "FOC_PAYER_ADDRESS",
  "FOC_DATASET_A_ID",
  "FOC_DATASET_A_PROVIDER_ID",
  "FOC_DATASET_B_ID",
  "FOC_DATASET_B_PROVIDER_ID",
];
const missing = REQUIRED.filter((k) => !process.env[k]);
const wrongChain = (process.env.FOC_CHAIN_ID ?? "314159") !== "314159";
const reason = missing.length
  ? `missing ${missing.join(", ")} (no Calibration wallet on this host)`
  : wrongChain
    ? "FOC_CHAIN_ID must be 314159"
    : "";
if (reason) console.warn(`[calibration.int] SKIPPED: ${reason}`);

describe.skipIf(Boolean(reason))(
  `Calibration store/commit split${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("store (no key) → commit (session key) → status → download from provider and FilBeam", async () => {
      const cfg = focConfigFromEnv({ ...process.env, FOC_CHAIN_ID: "314159" });
      const reader = await createFocReader(cfg);
      const custodian = await createFocCustodian({
        ...cfg,
        sessionKeyPk: process.env.FOC_SESSION_PK as Hex,
      });
      expect((await custodian.sessionExpiry()).secondsLeft).toBeGreaterThan(0);
      for (const ds of ["A", "B"] as DataSetRole[]) {
        const bytes = crypto.getRandomValues(new Uint8Array(200));
        const sha = createHash("sha256").update(bytes).digest("hex");
        const cid = await Piece.calculate(bytes);
        const t0 = Date.now();
        await reader.storeOriginal(ds, bytes, cid);
        const t1 = Date.now();
        const c = await custodian.commitPieces(ds, [
          { pieceCid: cid, metadata: { stamp: "5VEB-TVRA-F", role: "original", sha256: sha } },
        ]);
        console.log(
          `[calibration.int] ${ds} store ${t1 - t0} ms, commit ${Date.now() - t1} ms, tx ${c.txHash}`,
        );
        expect(c.dataSetId).toBe(cfg.dataSets[ds].id);
        expect((await reader.pieceStatus(ds, cid))?.pieceId).toBeDefined();
        const urls = await reader.retrievalUrls(cid);
        const prov = urls.providers.find((p) => p.providerId === cfg.dataSets[ds].providerId);
        const d = await downloadAndVerify(prov?.url ?? "", { sha256: `0x${sha}`, pieceCid: cid });
        expect(d.ok, d.error).toBe(true);
        if (ds === "A" && urls.filbeam) {
          const f = await downloadAndVerify(
            urls.filbeam,
            { sha256: `0x${sha}`, pieceCid: cid },
            { timeoutMs: 120_000 },
          );
          console.log(`[calibration.int] FilBeam ok=${f.ok} status=${f.status} ${f.ms} ms`);
          expect(f.ok, f.error).toBe(true);
        }
        const h = await reader.dataSetHealth(ds);
        expect(h.listenerIsFwss && h.live).toBe(true);
      }
    }, 600_000);
  },
);
