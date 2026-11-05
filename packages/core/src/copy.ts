/**
 * User-facing copy tables owned by @stamper/core (plan §4.10). Web and mobile never hard-code these.
 * No sentence may use the banned words (plan §0.6); `containsBannedWord` is what the copy tests use.
 */

export const BANNED_WORDS = [
  "verified",
  "authentic",
  "real",
  "same",
  "matches",
  "identical",
] as const;

/** Whole-word, case-insensitive check (so "already" or "streams" do not trip it). */
export function containsBannedWord(text: string): string | null {
  for (const w of BANNED_WORDS) if (new RegExp(`\\b${w}\\b`, "i").test(text)) return w;
  return null;
}

/**
 * The fixed footer (DESIGN §1.2), worded without the banned word "matches":
 * "…whether the copy you have is byte-for-byte the stored original…".
 */
export const FOOTER =
  "Stamper shows when this file was registered, by what kind of device, and whether the copy you have is byte-for-byte the stored original. It does not judge what the picture shows.";

export type TierInput = {
  level: number;
  keyType: number;
  countersigned: boolean;
  revokedBeforeStamp: boolean;
  registrarRemoved: boolean;
  offline: boolean;
  serverComputedCid: boolean;
};

export type TierSentence = { headline: string; means: string; doesNotMean: string };

const ANALOG = "a photo of a screen, a print or a staged scene";

const TIERS: Record<0 | 1 | 2, TierSentence> = {
  0: {
    headline: "Registered upload — device not attested",
    means:
      "A device key signed this file's fingerprints and the chain recorded them at the time shown.",
    doesNotMean: `Nothing checked the device or the capture, so where the file came from rests on the uploader's word. It also cannot rule out ${ANALOG}.`,
  },
  1: {
    headline: "Captured in the Stamper app — attestation checked by Stamper at upload",
    means:
      "An enrolled device key signed this capture; the chain checked that signature and Stamper's countersignature, and Stamper checked the platform attestation before registering it.",
    doesNotMean: `It cannot rule out a modified operating system, a leaked device key, camera injection, or ${ANALOG}.`,
  },
  2: {
    headline: "Hardware-attested capture",
    means:
      "A hardware-held device key signed this capture and the chain checked that signature itself.",
    doesNotMean: `It cannot rule out an unrevoked leaked key, a private exploit of the phone, or ${ANALOG}.`,
  },
};

/** Tier sentence for the verify page header and the "means / does not mean" record panel. */
export function tierSentence(input: TierInput): TierSentence {
  if (!input || typeof input.level !== "number") throw new TypeError("tierSentence needs a level");
  const level: 0 | 1 | 2 = input.revokedBeforeStamp
    ? 0
    : input.level >= 2
      ? 2
      : input.level >= 1
        ? 1
        : 0;
  const base = TIERS[level];
  const means: string[] = [base.means];
  const notes: string[] = [base.doesNotMean];
  if (input.revokedBeforeStamp) {
    notes.push(
      "The device key was revoked before this registration, so it is shown as an unattested upload.",
    );
  }
  if (input.registrarRemoved) {
    notes.push("The registrar that endorsed this device key has since been removed.");
  }
  // Hardware keys (P256_RAW = 1, P256_APPATTEST = 2) carry their level without a countersignature (DESIGN §4.3).
  if (level >= 1 && !input.countersigned && input.keyType !== 1 && input.keyType !== 2) {
    notes.push("This registration carries no per-capture countersignature.");
  }
  if (input.offline) {
    means.push("It was signed offline; the capture time is the device clock's claim.");
  }
  if (input.serverComputedCid) {
    means.push(
      "Stamper's server computed the Filecoin piece identifier; the device signed the file's SHA-256.",
    );
  }
  return { headline: base.headline, means: means.join(" "), doesNotMean: notes.join(" ") };
}
