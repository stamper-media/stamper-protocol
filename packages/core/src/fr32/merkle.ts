/** sha256-trunc254 binary merkle tree used by CommP / PieceCID. */
import { sha256 } from "@noble/hashes/sha2";

const pair = new Uint8Array(64);

/** `sha256(left ‖ right)` with the two most significant bits of the last byte cleared. */
export function node(left: Uint8Array, right: Uint8Array): Uint8Array {
  pair.set(left, 0);
  pair.set(right, 32);
  const h = sha256(pair);
  h[31] = (h[31] as number) & 0x3f;
  return h;
}

const zeroCache: Uint8Array[] = [new Uint8Array(32)];

/** Root of an all-zero subtree of the given level (level 0 = one 32-byte leaf). */
export function zeroComm(level: number): Uint8Array {
  while (zeroCache.length <= level) {
    const prev = zeroCache[zeroCache.length - 1] as Uint8Array;
    zeroCache.push(node(prev, prev));
  }
  return zeroCache[level] as Uint8Array;
}

/** Streaming tree builder: push leaves in order, then `root(height)` pads with zero subtrees. */
export class StackTree {
  private stack: Array<Uint8Array | undefined> = [];

  push(leaf: Uint8Array, level = 0): void {
    let n = leaf;
    let l = level;
    for (;;) {
      const left = this.stack[l];
      if (!left) break;
      n = node(left, n);
      this.stack[l] = undefined;
      l++;
    }
    this.stack[l] = n;
  }

  root(height: number): Uint8Array {
    for (let l = 0; l < height; l++) {
      if (this.stack[l]) this.push(zeroComm(l), l);
    }
    const r = this.stack[height];
    if (!r) return zeroComm(height);
    for (let l = height + 1; l < this.stack.length; l++) {
      if (this.stack[l]) throw new Error("tree overflow: more leaves than the declared height");
    }
    return r;
  }
}
