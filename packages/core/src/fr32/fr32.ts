/** fr32 expansion: 127 input bytes (4 × 254 bits) → 128 output bytes (4 × 256-bit field elements). */
export const IN_BYTES_PER_QUAD = 127;
export const OUT_BYTES_PER_QUAD = 128;

/** Expands one 127-byte quad into `out` (128 bytes) at `offset`. */
export function expandQuad(input: Uint8Array, out: Uint8Array, offset = 0): void {
  if (input.length !== IN_BYTES_PER_QUAD) throw new RangeError("fr32 quad must be 127 bytes");
  const o = offset;
  for (let i = 0; i < 32; i++) out[o + i] = input[i] as number;
  out[o + 31] = (out[o + 31] as number) & 0x3f;
  for (let i = 32; i < 64; i++)
    out[o + i] = ((input[i] as number) << 2) | ((input[i - 1] as number) >> 6);
  out[o + 63] = (out[o + 63] as number) & 0x3f;
  for (let i = 64; i < 96; i++)
    out[o + i] = ((input[i] as number) << 4) | ((input[i - 1] as number) >> 4);
  out[o + 95] = (out[o + 95] as number) & 0x3f;
  for (let i = 96; i < 127; i++)
    out[o + i] = ((input[i] as number) << 6) | ((input[i - 1] as number) >> 2);
  out[o + 127] = (input[126] as number) >> 2;
}
