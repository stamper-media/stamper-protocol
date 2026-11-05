/**
 * Pure-JS PieceCID v2 (FRC-0069) fallback: 127-byte quads → fr32 → sha256-trunc254 merkle.
 * Produces raw CID bytes `0x01 0x55 0x91 0x20 ‖ uvarint(mhLen) ‖ uvarint(padding) ‖ height ‖ root`.
 */
import { expandQuad, IN_BYTES_PER_QUAD, OUT_BYTES_PER_QUAD } from "./fr32.js";
import { StackTree } from "./merkle.js";

export { expandQuad } from "./fr32.js";
export { node, zeroComm } from "./merkle.js";

/** Largest supported payload (2^255 padded is out of reach anyway; keep within safe integers). */
const MAX_PAYLOAD = BigInt(Number.MAX_SAFE_INTEGER);

export function uvarint(n: bigint): Uint8Array {
  if (n < 0n) throw new RangeError("uvarint must be non-negative");
  const out: number[] = [];
  let v = n;
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    out.push(b);
  } while (v > 0n);
  return Uint8Array.from(out);
}

function log2Ceil(n: bigint): number {
  let l = 0;
  while (1n << BigInt(l) < n) l++;
  return l;
}

/** Sizing exactly as synapse-core: quads = nextPow2(ceil(n/127)), height = log2(4·quads). */
export function sizing(payloadLength: bigint): { quads: bigint; padding: bigint; height: number } {
  const quadCount = (payloadLength + 126n) / 127n;
  const quads = 1n << BigInt(log2Ceil(quadCount));
  return { quads, padding: quads * 127n - payloadLength, height: log2Ceil(quads * 4n) };
}

export function encodePieceCidV2(padding: bigint, height: number, root: Uint8Array): Uint8Array {
  if (root.length !== 32) throw new RangeError("root must be 32 bytes");
  if (!Number.isInteger(height) || height < 0 || height > 255)
    throw new RangeError("height must be uint8");
  const pad = uvarint(padding);
  const mh = uvarint(BigInt(pad.length + 1 + 32));
  const out = new Uint8Array(4 + mh.length + pad.length + 1 + 32);
  out.set([0x01, 0x55, 0x91, 0x20], 0);
  let o = 4;
  out.set(mh, o);
  o += mh.length;
  out.set(pad, o);
  o += pad.length;
  out[o++] = height;
  out.set(root, o);
  return out;
}

export type Fr32Hasher = { write(chunk: Uint8Array): void; count(): bigint; digest(): Uint8Array };

/** Streaming fr32 PieceCID hasher. `digest()` returns raw PieceCID v2 bytes. */
export function fr32Hasher(): Fr32Hasher {
  const buf = new Uint8Array(IN_BYTES_PER_QUAD);
  const expanded = new Uint8Array(OUT_BYTES_PER_QUAD);
  const tree = new StackTree();
  let offset = 0;
  let total = 0n;
  let done = false;

  const flushQuad = (quad: Uint8Array) => {
    expandQuad(quad, expanded, 0);
    for (let i = 0; i < 4; i++) tree.push(expanded.slice(i * 32, i * 32 + 32));
  };

  return {
    write(chunk: Uint8Array) {
      if (done) throw new Error("hasher already finalised");
      if (!(chunk instanceof Uint8Array)) throw new TypeError("chunk must be a Uint8Array");
      if (total + BigInt(chunk.length) > MAX_PAYLOAD) throw new RangeError("payload too large");
      let i = 0;
      while (i < chunk.length) {
        const take = Math.min(IN_BYTES_PER_QUAD - offset, chunk.length - i);
        buf.set(chunk.subarray(i, i + take), offset);
        offset += take;
        i += take;
        if (offset === IN_BYTES_PER_QUAD) {
          flushQuad(buf);
          offset = 0;
        }
      }
      total += BigInt(chunk.length);
    },
    count: () => total,
    digest() {
      if (done) throw new Error("hasher already finalised");
      done = true;
      if (offset > 0 || total === 0n) {
        buf.fill(0, offset);
        flushQuad(buf);
      }
      const { padding, height } = sizing(total);
      return encodePieceCidV2(padding, height, tree.root(height));
    },
  };
}

/** One-shot pure-JS PieceCID v2 bytes. */
export function fr32PieceCid(bytes: Uint8Array): Uint8Array {
  const h = fr32Hasher();
  h.write(bytes);
  return h.digest();
}
