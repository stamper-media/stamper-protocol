import { findPieceIdsByCid } from "@filoz/synapse-core/pdp-verifier";
import {
  AddPiecesPermission,
  authorizationExpiry,
  fromSecp256k1,
} from "@filoz/synapse-core/session-key";
import { Synapse } from "@filoz/synapse-sdk";
import { type Chain, type Client, type Hex, http, isHex, type Transport } from "viem";
import { chainFor, parseFocConfig } from "./config.js";
import { toPieceMetadata } from "./metadata.js";
import { SynapseFocReader } from "./reader.js";
import {
  type CommitPiece,
  type CommitResult,
  type DataSetRole,
  type FocConfig,
  type FocCustodian,
  FocError,
  type PreflightResult,
  type Runway,
} from "./types.js";

/** Max pieces per addPieces call (keeps calldata and gas bounded). */
export const MAX_PIECES_PER_COMMIT = 32;
/** Filecoin epoch length in seconds. */
export const EPOCH_SECONDS = 30;

export function computeRunway(
  acct: {
    funds: bigint;
    lockupCurrent: bigint;
    lockupRate: bigint;
    lockupLastSettledAt: bigint;
    availableFunds: bigint;
  },
  currentEpoch: bigint,
): Runway {
  let fundedUntilEpoch: bigint | null = null;
  let days: number | null = null;
  if (acct.lockupRate > 0n) {
    const spare = acct.funds > acct.lockupCurrent ? acct.funds - acct.lockupCurrent : 0n;
    fundedUntilEpoch = acct.lockupLastSettledAt + spare / acct.lockupRate;
    const left = fundedUntilEpoch - currentEpoch;
    days = (Number(left > 0n ? left : 0n) * EPOCH_SECONDS) / 86_400;
  }
  return {
    fundedUntilEpoch,
    days,
    availableUsdfc: acct.availableFunds,
    lockupUsdfc: acct.lockupCurrent,
  };
}

class SynapseFocCustodian extends SynapseFocReader implements FocCustodian {
  constructor(
    synapse: Synapse,
    cfg: FocConfig,
    private readonly sessionKeyAddress: Hex,
  ) {
    super(synapse, cfg);
  }

  async commitPieces(ds: DataSetRole, pieces: CommitPiece[]): Promise<CommitResult> {
    if (!Array.isArray(pieces) || pieces.length === 0) {
      throw new FocError("config", "commitPieces needs at least one piece");
    }
    if (pieces.length > MAX_PIECES_PER_COMMIT) {
      throw new FocError("config", `at most ${MAX_PIECES_PER_COMMIT} pieces per commit`);
    }
    const pin = this.cfg.dataSets[ds];
    const ctx = await this.context(ds); // asserts the pinned dataSetId/providerId
    // A retry must not add a piece twice: an SP can land AddPieces yet never report it (Calibration,
    // 2026-10-30: waitForAddPieces timed out six times and left six copies in the data set).
    const before = await this.landedPieceIds(pin.id, pieces);
    const todo = pieces.filter((_, i) => before[i] === null);
    if (todo.length === 0) {
      return { txHash: null, pieceIds: before as bigint[], dataSetId: pin.id };
    }
    let submitted = null as Hex | null; // set from a callback, so keep it un-narrowed
    let res: Awaited<ReturnType<typeof ctx.commit>>;
    try {
      res = await ctx.commit({
        pieces: todo.map((p) => ({
          pieceCid: p.pieceCid,
          pieceMetadata: toPieceMetadata(p.metadata),
        })),
        onSubmitted: (h) => {
          submitted = h;
        },
      });
    } catch (err) {
      // submitted but never confirmed by the SP: the chain decides
      if (submitted === null) throw err;
      const after = await this.landedPieceIds(pin.id, pieces).catch(() => null);
      if (!after || after.some((id) => id === null)) throw err;
      return { txHash: submitted, pieceIds: after as bigint[], dataSetId: pin.id };
    }
    if (res.isNewDataSet || res.dataSetId !== pin.id) {
      throw new FocError("pin", `commit landed in data set ${res.dataSetId}, expected ${pin.id}`);
    }
    let k = 0;
    return {
      txHash: res.confirmedTxHash ?? res.txHash,
      pieceIds: before.map((id) => id ?? (res.pieceIds[k++] as bigint)),
      dataSetId: res.dataSetId,
    };
  }

  /** First live piece id for each PieceCID in the data set, read from PDPVerifier; null if absent. */
  private landedPieceIds(dataSetId: bigint, pieces: CommitPiece[]): Promise<(bigint | null)[]> {
    const client = this.synapse.readClient as unknown as Client<Transport, Chain>;
    return Promise.all(
      pieces.map(async (p) => {
        const page = await findPieceIdsByCid(client, { dataSetId, pieceCid: p.pieceCid });
        return page.items[0] ?? null;
      }),
    );
  }

  async preflight(pieceSizes: number[]): Promise<PreflightResult> {
    if (!pieceSizes.every((n) => Number.isSafeInteger(n) && n > 0)) {
      throw new FocError("config", "pieceSizes must be positive integers");
    }
    const contexts = await Promise.all([this.context("A"), this.context("B")]);
    const r = await this.synapse.storage.prepare({
      context: contexts,
      pieceSizes: pieceSizes.map((n) => BigInt(n)),
    });
    const allowanceOk = !r.costs.needsFwssMaxApproval;
    const fundsOk = r.costs.depositNeeded === 0n;
    return {
      ok: r.transaction === null && allowanceOk && fundsOk,
      allowanceOk,
      fundsOk,
      details: { costs: r.costs, depositAmount: r.transaction?.depositAmount ?? 0n },
    };
  }

  async runway(): Promise<Runway> {
    const [acct, block] = await Promise.all([
      this.synapse.payments.accountInfo(),
      this.synapse.readClient.getBlockNumber(),
    ]);
    return computeRunway(acct, block);
  }

  async sessionExpiry(): Promise<{ expiresAt: Date; secondsLeft: number }> {
    const exp = await authorizationExpiry(
      this.synapse.readClient as unknown as Client<Transport, Chain>,
      {
        address: this.cfg.payerAddress,
        sessionKeyAddress: this.sessionKeyAddress,
        permission: AddPiecesPermission,
      },
    );
    const expiresAt = new Date(Number(exp) * 1000);
    return {
      expiresAt,
      secondsLeft: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
    };
  }
}

/**
 * Custodian (api only): AddPieces-only session key on behalf of the cold payer. Throws at start-up
 * if the key is not authorised for AddPieces or the authorisation has expired.
 */
export async function createFocCustodian(
  input: FocConfig & { sessionKeyPk: Hex },
): Promise<FocCustodian> {
  const { sessionKeyPk, ...rest } = input;
  if (!isHex(sessionKeyPk, { strict: true }) || sessionKeyPk.length !== 66) {
    throw new FocError("session_key", "sessionKeyPk must be a 32-byte 0x-prefixed hex private key");
  }
  const cfg = parseFocConfig(rest);
  const chain = chainFor(cfg.chainId);
  const transport = http(cfg.rpcUrl);
  const sessionKey = fromSecp256k1({
    privateKey: sessionKeyPk,
    root: cfg.payerAddress,
    chain,
    transport,
  });
  try {
    await sessionKey.syncExpirations([AddPiecesPermission]);
  } catch (cause) {
    throw new FocError("session_key", "could not read session key authorisation from chain", {
      cause,
    });
  }
  if (!sessionKey.hasPermission(AddPiecesPermission)) {
    const exp = sessionKey.expirations[AddPiecesPermission] ?? 0n;
    throw new FocError(
      "session_key",
      exp === 0n
        ? `session key ${sessionKey.address} lacks AddPiecesPermission for ${cfg.payerAddress}`
        : `session key AddPiecesPermission expired at ${new Date(Number(exp) * 1000).toISOString()}`,
    );
  }
  const synapse = Synapse.create({
    account: cfg.payerAddress,
    chain,
    transport,
    source: cfg.source,
    sessionKey,
    requiredPermissions: [AddPiecesPermission],
    pieceBatching: { wait: { kind: "limiter" } },
  });
  return new SynapseFocCustodian(synapse, cfg, sessionKey.address);
}
