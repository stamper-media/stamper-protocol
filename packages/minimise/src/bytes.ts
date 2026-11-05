/** Thrown for malformed, truncated or unsupported input. Never thrown for well-formed media. */
export class MinimiseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MinimiseError";
  }
}

export function fail(message: string): never {
  throw new MinimiseError(message);
}

export function assertBytes(value: unknown, what = "input"): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${what} must be a Uint8Array`);
}

/** Runs `fn`, converting any unexpected exception into a MinimiseError. */
export function guarded<T>(what: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof MinimiseError || e instanceof TypeError) throw e;
    throw new MinimiseError(`${what}: malformed input`, { cause: e });
  }
}

/** Latin-1 decode (box types, segment identifiers). No TextDecoder: Hermes-safe. */
export function latin1(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  const e = Math.min(end, bytes.length);
  for (let i = start; i < e; i++) s += String.fromCharCode(bytes[i] as number);
  return s;
}

export function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function startsWith(bytes: Uint8Array, at: number, prefix: string): boolean {
  if (at + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[at + i] !== prefix.charCodeAt(i)) return false;
  return true;
}

export function concat(chunks: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function u16be(b: Uint8Array, at: number): number {
  if (at + 2 > b.length) fail("unexpected end of data");
  return ((b[at] as number) << 8) | (b[at + 1] as number);
}

export function u32be(b: Uint8Array, at: number): number {
  if (at + 4 > b.length) fail("unexpected end of data");
  return (
    (b[at] as number) * 0x1000000 +
    (((b[at + 1] as number) << 16) | ((b[at + 2] as number) << 8) | (b[at + 3] as number))
  );
}

export function u64be(b: Uint8Array, at: number): number {
  const hi = u32be(b, at);
  const lo = u32be(b, at + 4);
  const v = hi * 0x100000000 + lo;
  if (!Number.isSafeInteger(v)) fail("64-bit size exceeds safe integer range");
  return v;
}

export function setU32be(b: Uint8Array, at: number, v: number): void {
  b[at] = (v >>> 24) & 0xff;
  b[at + 1] = (v >>> 16) & 0xff;
  b[at + 2] = (v >>> 8) & 0xff;
  b[at + 3] = v & 0xff;
}

export function setU64be(b: Uint8Array, at: number, v: number): void {
  setU32be(b, at, Math.floor(v / 0x100000000));
  setU32be(b, at + 4, v >>> 0);
}

export function pushUnique(list: string[], item: string): void {
  if (!list.includes(item)) list.push(item);
}
