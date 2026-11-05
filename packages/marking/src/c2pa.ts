import { normaliseCode } from "@stamper/core";
import type { Address, Hex } from "viem";
import { isAddress } from "viem";
import { z } from "zod";

export const C2PA_ANCHOR_LABEL = "media.stamper.anchor" as const;

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const anchorSchema = z.strictObject({
  stampId: hex32,
  // Full code check (alphabet incl. the check symbols *~$=U, and the mod-37 checksum) via core.
  code9: z.string().transform((s, ctx) => {
    const c = normaliseCode(s);
    if (!c.ok) {
      ctx.addIssue({ code: "custom", message: `invalid code (${c.reason})` });
      return z.NEVER;
    }
    return c.code9;
  }),
  contentHash: hex32,
  pieceCid: z.string().regex(/^bafkzcib[a-z2-7]+$/),
  derivedHash: hex32,
  registry: z.strictObject({
    chainId: z.number().int().positive(),
    address: z.string().refine((a) => isAddress(a, { strict: false }), "invalid address"),
    txHash: hex32,
    epoch: z.bigint().nonnegative(),
  }),
  level: z.number().int().min(0).max(2),
});

export type C2paAnchorInput = {
  stampId: Hex;
  code9: string;
  contentHash: Hex;
  pieceCid: string;
  derivedHash: Hex;
  registry: { chainId: number; address: Address; txHash: Hex; epoch: bigint };
  level: number;
};

/** DESIGN §6.3 custom assertion (v1 hook; no c2pa-node dependency in the MVP). Wire encodings per plan §4. */
export function buildC2paAnchorAssertion(a: C2paAnchorInput): {
  label: typeof C2PA_ANCHOR_LABEL;
  data: Record<string, unknown>;
} {
  const p = anchorSchema.parse(a);
  return {
    label: C2PA_ANCHOR_LABEL,
    data: {
      stampId: p.stampId.toLowerCase(),
      code: p.code9,
      contentHash: p.contentHash.toLowerCase(),
      pieceCid: p.pieceCid,
      derivedHash: p.derivedHash.toLowerCase(),
      registry: {
        chainId: p.registry.chainId,
        address: p.registry.address,
        txHash: p.registry.txHash.toLowerCase(),
        epoch: p.registry.epoch.toString(),
      },
      level: p.level,
    },
  };
}

export interface C2paSigner {
  sign(manifest: unknown): Promise<Uint8Array>;
}

export function notImplemented(feature = "C2PA signing"): never {
  throw new Error(`${feature} is a v1 feature and is not implemented in the MVP (DESIGN §6.3)`);
}

/** Placeholder signer: every call rejects with a clear error. */
export const unimplementedC2paSigner: C2paSigner = {
  sign: async () => notImplemented(),
};
