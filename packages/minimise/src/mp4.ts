import {
  assertBytes,
  concat,
  fail,
  guarded,
  latin1,
  MinimiseError,
  pushUnique,
  setU32be,
  setU64be,
  startsWith,
  u32be,
  u64be,
} from "./bytes.js";
import { sniff } from "./sniff.js";
import type {
  ByteSink,
  ByteSource,
  MinimiseReport,
  MinimiseResult,
  Mp4Inspection,
} from "./types.js";

/** Above this size, prefer `minimiseMp4Stream` so the media data never has to sit in memory. */
export const STREAM_THRESHOLD = 64 * 1024 * 1024;
/** Upper bound for a moov box loaded into memory by the streaming variant. */
export const MAX_MOOV_BYTES = 256 * 1024 * 1024;

const XMP_UUID = [
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
];
/** Containers walked by the rewriter (udta and meta are handled separately). */
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "mvex"]);
/** Containers walked by the inspector. */
const INSPECT_CONTAINERS = new Set([...CONTAINERS, "udta", "meta", "moof", "traf", "mfra"]);
/** mdta keys that are dropped from moov/meta and trak/meta (location, device identity, owner). */
const DROP_KEY = /location|iso6709|gps|serial|owner|identifier/i;
const LOCATION_KEY = /location|iso6709|gps/i;

type Box = { type: string; start: number; header: number; end: number };
type Ctx = { removed: string[] };
type Res = { kind: "keep" } | { kind: "drop" } | { kind: "new"; bytes: Uint8Array };

function readBox(b: Uint8Array, pos: number, end: number, toEndOk: boolean): Box {
  if (end - pos < 8) fail("MP4: truncated box header");
  let size = u32be(b, pos);
  const type = latin1(b, pos + 4, pos + 8);
  let header = 8;
  if (size === 1) {
    if (end - pos < 16) fail("MP4: truncated largesize header");
    size = u64be(b, pos + 8);
    header = 16;
  } else if (size === 0) {
    if (!toEndOk) fail(`MP4: size-0 box '${type}' inside a container`);
    size = end - pos;
  }
  if (size < header) fail(`MP4: box '${type}' smaller than its header`);
  if (pos + size > end) fail(`MP4: box '${type}' exceeds its parent`);
  return { type, start: pos, header, end: pos + size };
}

/** Children of [start, end). A tail shorter than a box header (QuickTime terminator) is returned as `tail`. */
function readChildren(b: Uint8Array, start: number, end: number): { boxes: Box[]; tail: number } {
  const boxes: Box[] = [];
  let pos = start;
  while (end - pos >= 8) {
    const box = readBox(b, pos, end, false);
    boxes.push(box);
    pos = box.end;
  }
  return { boxes, tail: pos };
}

function isXmpUuid(b: Uint8Array, box: Box): boolean {
  const at = box.start + box.header;
  if (box.end - at < 16) return false;
  for (let i = 0; i < 16; i++) if (b[at + i] !== XMP_UUID[i]) return false;
  return true;
}

function wrap(type: string, parts: readonly Uint8Array[]): Uint8Array {
  let body = 0;
  for (const p of parts) body += p.length;
  const small = body + 8 <= 0xffffffff;
  const head = new Uint8Array(small ? 8 : 16);
  for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i) & 0xff;
  if (small) setU32be(head, 0, body + 8);
  else {
    setU32be(head, 0, 1);
    setU64be(head, 8, body + 16);
  }
  return concat([head, ...parts]);
}

/** Lists child box types of a box without failing (for the removed report). */
function childTypes(b: Uint8Array, box: Box, prefix: number): string[] {
  try {
    return readChildren(b, box.start + box.header + prefix, box.end).boxes.map((c) => c.type);
  } catch {
    return [];
  }
}

/** QuickTime `meta` has no version/flags; ISO `meta` is a FullBox. */
function metaPrefix(b: Uint8Array, box: Box): number {
  return startsWith(b, box.start + box.header + 4, "hdlr") ? 0 : 4;
}

type KeyEntry = { name: string; bytes: Uint8Array };

function parseKeys(b: Uint8Array, box: Box): KeyEntry[] {
  const p = box.start + box.header;
  const n = u32be(b, p + 4);
  const out: KeyEntry[] = [];
  let pos = p + 8;
  for (let i = 0; i < n; i++) {
    const size = u32be(b, pos);
    if (size < 8 || pos + size > box.end) fail("MP4: bad keys entry");
    out.push({ name: latin1(b, pos + 8, pos + size), bytes: b.subarray(pos, pos + size) });
    pos += size;
  }
  return out;
}

function rewriteMeta(b: Uint8Array, box: Box, ctx: Ctx): Res {
  const prefix = metaPrefix(b, box);
  const payload = box.start + box.header;
  const { boxes, tail } = readChildren(b, payload + prefix, box.end);
  const hdlr = boxes.find((c) => c.type === "hdlr");
  const isMdta =
    hdlr !== undefined &&
    latin1(b, hdlr.start + hdlr.header + 8, hdlr.start + hdlr.header + 12) === "mdta";
  const keysBox = boxes.find((c) => c.type === "keys");
  const keys = isMdta && keysBox ? parseKeys(b, keysBox) : [];
  // old 1-based index -> new 1-based index (0 = dropped)
  const remap: number[] = [0];
  let next = 1;
  for (const k of keys) {
    if (DROP_KEY.test(k.name)) {
      remap.push(0);
      pushUnique(ctx.removed, `meta/${k.name}`);
    } else remap.push(next++);
  }
  let changed = false;
  const parts: Uint8Array[] = [b.subarray(payload, payload + prefix)];
  for (const c of boxes) {
    if (c.type === "udta" || (c.type === "uuid" && isXmpUuid(b, c))) {
      pushUnique(ctx.removed, c.type === "udta" ? "udta" : "uuid:XMP");
      changed = true;
      continue;
    }
    if (c.type === "keys" && isMdta && next - 1 !== keys.length) {
      const kept = keys.filter((_, i) => remap[i + 1] !== 0).map((k) => k.bytes);
      const head = b.slice(c.start + c.header, c.start + c.header + 8);
      setU32be(head, 4, kept.length);
      parts.push(wrap("keys", [head, ...kept]));
      changed = true;
      continue;
    }
    if (c.type === "ilst") {
      const items = readChildren(b, c.start + c.header, c.end);
      const out: Uint8Array[] = [];
      let ilstChanged = false;
      for (const it of items.boxes) {
        if (isMdta) {
          const idx = u32be(b, it.start + 4);
          const to = idx < remap.length ? (remap[idx] as number) : 0;
          if (to === 0) {
            ilstChanged = true;
            continue;
          }
          if (to !== idx) {
            const copy = b.slice(it.start, it.end);
            setU32be(copy, 4, to);
            out.push(copy);
            ilstChanged = true;
            continue;
          }
        } else if (it.type === "\xa9xyz") {
          pushUnique(ctx.removed, "meta/\xa9xyz");
          ilstChanged = true;
          continue;
        }
        out.push(b.subarray(it.start, it.end));
      }
      if (ilstChanged) {
        out.push(b.subarray(items.tail, c.end));
        parts.push(wrap("ilst", out));
        changed = true;
        continue;
      }
    }
    parts.push(b.subarray(c.start, c.end));
  }
  if (!changed) return { kind: "keep" };
  parts.push(b.subarray(tail, box.end));
  return { kind: "new", bytes: wrap("meta", parts) };
}

function rewriteBox(b: Uint8Array, box: Box, ctx: Ctx): Res {
  if (box.type === "udta") {
    pushUnique(ctx.removed, "udta");
    for (const t of childTypes(b, box, 0)) pushUnique(ctx.removed, `udta/${t}`);
    return { kind: "drop" };
  }
  if (box.type === "uuid" && isXmpUuid(b, box)) {
    pushUnique(ctx.removed, "uuid:XMP");
    return { kind: "drop" };
  }
  if (box.type === "meta") return rewriteMeta(b, box, ctx);
  if (!CONTAINERS.has(box.type)) return { kind: "keep" };
  const payload = box.start + box.header;
  const { boxes, tail } = readChildren(b, payload, box.end);
  const parts: Uint8Array[] = [];
  let changed = false;
  for (const c of boxes) {
    const r = rewriteBox(b, c, ctx);
    if (r.kind === "keep") parts.push(b.subarray(c.start, c.end));
    else {
      changed = true;
      if (r.kind === "new") parts.push(r.bytes);
    }
  }
  if (!changed) return { kind: "keep" };
  parts.push(b.subarray(tail, box.end));
  return { kind: "new", bytes: wrap(box.type, parts) };
}

/** Calls `fn` for every stco/co64 box inside a standalone moov. */
function eachChunkOffsetBox(m: Uint8Array, fn: (box: Box) => void): void {
  const walk = (start: number, end: number): void => {
    for (const c of readChildren(m, start, end).boxes) {
      if (c.type === "stco" || c.type === "co64") fn(c);
      else if (CONTAINERS.has(c.type)) walk(c.start + c.header, c.end);
    }
  };
  const top = readBox(m, 0, m.length, false);
  walk(top.header, top.end);
}

type Change = { start: number; end: number; delta: number };

function shiftAt(changes: readonly Change[], x: number): number {
  let s = 0;
  for (const c of changes) {
    if (c.end <= x) s += c.delta;
    else if (c.start <= x && c.delta !== 0) fail("MP4: chunk offset points into a rewritten box");
  }
  return s;
}

function patchChunkOffsets(m: Uint8Array, changes: readonly Change[]): void {
  eachChunkOffsetBox(m, (box) => {
    const p = box.start + box.header;
    const n = u32be(m, p + 4);
    const w = box.type === "co64" ? 8 : 4;
    if (p + 8 + n * w > box.end) fail(`MP4: ${box.type} entry count exceeds box`);
    for (let i = 0; i < n; i++) {
      const at = p + 8 + i * w;
      const old = w === 8 ? u64be(m, at) : u32be(m, at);
      const v = old - shiftAt(changes, old);
      if (w === 8) setU64be(m, at, v);
      else setU32be(m, at, v);
    }
  });
}

/** Width/height of the first track with a non-zero tkhd size. */
function videoDims(m: Uint8Array): { width: number; height: number } | undefined {
  const top = readBox(m, 0, m.length, false);
  for (const trak of readChildren(m, top.header, top.end).boxes) {
    if (trak.type !== "trak") continue;
    const tkhd = readChildren(m, trak.start + trak.header, trak.end).boxes.find(
      (c) => c.type === "tkhd",
    );
    if (!tkhd) continue;
    const p = tkhd.start + tkhd.header;
    const base = p + ((m[p] as number) === 1 ? 36 : 24) + 52;
    if (base + 8 > tkhd.end) continue;
    const width = Math.round(u32be(m, base) / 65536);
    const height = Math.round(u32be(m, base + 4) / 65536);
    if (width > 0 && height > 0) return { width, height };
  }
  return undefined;
}

/** Absolute tfhd base_data_offset would be invalidated by a shift. */
function moofHasAbsoluteOffsets(m: Uint8Array): boolean {
  const top = readBox(m, 0, m.length, false);
  for (const traf of readChildren(m, top.header, top.end).boxes) {
    if (traf.type !== "traf") continue;
    for (const c of readChildren(m, traf.start + traf.header, traf.end).boxes) {
      if (c.type === "tfhd" && ((m[c.start + c.header + 3] as number) & 1) === 1) return true;
    }
  }
  return false;
}

type ReadReq = { offset: number; length: number };
type Op = { copy: [number, number] } | { data: Uint8Array };
type Plan = { ops: Op[]; report: MinimiseReport };

/** The whole algorithm as a generator that asks for byte ranges; driven sync (memory) or async (stream). */
function* planMp4(size: number): Generator<ReadReq, Plan, Uint8Array> {
  const head = yield { offset: 0, length: Math.min(size, 32) };
  const kind = sniff(head);
  if (kind !== "video/mp4" && kind !== "video/quicktime")
    fail(`MP4: unsupported container (${kind})`);

  const top: Box[] = [];
  let pos = 0;
  while (size - pos >= 8) {
    const h = yield { offset: pos, length: Math.min(32, size - pos) };
    const box = readBox(h, 0, size - pos, true);
    const abs = {
      type: box.type,
      start: pos,
      header: box.header,
      end: pos + (box.end - box.start),
    };
    top.push(abs);
    if (abs.type === "uuid") (abs as Box & { xmp?: boolean }).xmp = isXmpUuid(h, box);
    pos = abs.end;
  }
  const tailStart = pos;
  if (!top.some((b) => b.type === "moov")) fail("MP4: no moov box");

  const ctx: Ctx = { removed: [] };
  const kept: string[] = [];
  const changes: Change[] = [];
  const newMoov = new Map<Box, Uint8Array>();
  for (const box of top) {
    const len = box.end - box.start;
    if ((box.type === "uuid" && (box as Box & { xmp?: boolean }).xmp) || box.type === "udta") {
      pushUnique(ctx.removed, box.type === "udta" ? "udta" : "uuid:XMP");
      changes.push({ start: box.start, end: box.end, delta: len });
      continue;
    }
    pushUnique(kept, box.type);
    if (box.type !== "moov") continue;
    if (len > MAX_MOOV_BYTES) fail("MP4: moov box too large");
    const raw = yield { offset: box.start, length: len };
    if (raw.length !== len) fail("MP4: truncated moov");
    const r = rewriteBox(raw, { type: "moov", start: 0, header: box.header, end: len }, ctx);
    if (r.kind === "drop") fail("MP4: moov cannot be dropped");
    const m = r.kind === "new" ? r.bytes : raw.slice();
    newMoov.set(box, m);
    changes.push({ start: box.start, end: box.end, delta: len - m.length });
  }

  for (const box of top) {
    if (box.type !== "moof" && box.type !== "mfra") continue;
    if (shiftAt(changes, box.start) === 0) continue;
    if (box.type === "mfra") fail("MP4: fragmented file with mfra index cannot be shifted");
    const raw = yield { offset: box.start, length: box.end - box.start };
    if (moofHasAbsoluteOffsets(raw))
      fail("MP4: fragmented file with absolute base offsets cannot be shifted");
  }

  const ops: Op[] = [];
  const report: MinimiseReport = { removed: ctx.removed, kept, publicExif: {} };
  for (const box of top) {
    const m = newMoov.get(box);
    if (m) {
      patchChunkOffsets(m, changes);
      const dims = videoDims(m);
      if (dims && report.width === undefined) {
        report.width = dims.width;
        report.height = dims.height;
      }
      ops.push({ data: m });
    } else if (!changes.some((c) => c.start === box.start && c.delta === box.end - box.start)) {
      ops.push({ copy: [box.start, box.end] });
    }
  }
  if (tailStart < size) ops.push({ copy: [tailStart, size] });
  return { ops, report };
}

/**
 * Removes moov/udta (©xyz, ©mak, ©mod, ...), location/serial/owner keys of moov/meta and trak/meta,
 * and XMP uuid boxes; fixes parent sizes and stco/co64 chunk offsets. mdat is copied untouched.
 */
export function minimiseMp4(bytes: Uint8Array): MinimiseResult {
  assertBytes(bytes);
  return guarded("MP4", () => {
    const gen = planMp4(bytes.length);
    let step = gen.next();
    while (!step.done) {
      const { offset, length } = step.value;
      step = gen.next(bytes.subarray(offset, offset + length));
    }
    const { ops, report } = step.value;
    return {
      bytes: concat(ops.map((o) => ("data" in o ? o.data : bytes.subarray(o.copy[0], o.copy[1])))),
      report,
    };
  });
}

/**
 * Streaming variant for large files: only box headers and moov are held in memory; the rest is
 * copied in `chunkSize` pieces from `source` to `sink`.
 */
export async function minimiseMp4Stream(
  source: ByteSource,
  sink: ByteSink,
  options: { chunkSize?: number } = {},
): Promise<MinimiseReport> {
  if (
    !source ||
    typeof source.read !== "function" ||
    !Number.isSafeInteger(source.size) ||
    source.size < 0
  ) {
    throw new TypeError("source must be a ByteSource with a non-negative integer size");
  }
  if (!sink || typeof sink.write !== "function") throw new TypeError("sink must be a ByteSink");
  const chunk = options.chunkSize ?? 4 * 1024 * 1024;
  if (!Number.isSafeInteger(chunk) || chunk < 1)
    throw new TypeError("chunkSize must be a positive integer");
  const read = async (offset: number, length: number): Promise<Uint8Array> => {
    const r = await source.read(offset, length);
    assertBytes(r, "source.read result");
    if (r.length !== Math.min(length, source.size - offset))
      throw new MinimiseError("MP4: short read from source");
    return r;
  };
  let plan: Plan;
  try {
    const gen = planMp4(source.size);
    let step = gen.next();
    while (!step.done) {
      const bytes = await read(step.value.offset, step.value.length);
      step = gen.next(bytes);
    }
    plan = step.value;
  } catch (e) {
    if (e instanceof MinimiseError || e instanceof TypeError) throw e;
    throw new MinimiseError("MP4: malformed input", { cause: e });
  }
  for (const op of plan.ops) {
    if ("data" in op) {
      await sink.write(op.data);
      continue;
    }
    for (let at = op.copy[0]; at < op.copy[1]; at += chunk) {
      await sink.write(await read(at, Math.min(chunk, op.copy[1] - at)));
    }
  }
  return plan.report;
}

export function inspectMp4(bytes: Uint8Array): Mp4Inspection {
  assertBytes(bytes);
  return guarded("MP4", () => {
    const kind = sniff(bytes);
    if (kind !== "video/mp4" && kind !== "video/quicktime")
      fail(`MP4: unsupported container (${kind})`);
    const res: Mp4Inspection = { hasUdta: false, hasLocation: false, boxes: [] };
    const walk = (start: number, end: number, parent: string, top: boolean): void => {
      let pos = start;
      while (end - pos >= 8) {
        const box = readBox(bytes, pos, end, top);
        pos = box.end;
        let label = box.type;
        if (box.type === "uuid" && isXmpUuid(bytes, box)) label = "uuid:XMP";
        const path = parent ? `${parent}/${label}` : label;
        res.boxes.push(path);
        if (box.type === "udta") res.hasUdta = true;
        if (box.type === "\xa9xyz" || box.type === "loci") res.hasLocation = true;
        if (box.type === "keys" && parent.endsWith("meta")) {
          for (const k of parseKeys(bytes, box)) {
            res.boxes.push(`${path}/${k.name}`);
            if (LOCATION_KEY.test(k.name)) res.hasLocation = true;
          }
        }
        if (box.type === "ilst" && parent.endsWith("meta")) {
          for (const it of readChildren(bytes, box.start + box.header, box.end).boxes) {
            if (it.type === "\xa9xyz") res.hasLocation = true;
          }
        }
        if (INSPECT_CONTAINERS.has(box.type)) {
          const prefix = box.type === "meta" ? metaPrefix(bytes, box) : 0;
          if (box.type === "udta") {
            try {
              walk(box.start + box.header, box.end, path, false);
            } catch {
              // QuickTime udta payloads are not always well-formed boxes; the udta itself is reported.
            }
          } else walk(box.start + box.header + prefix, box.end, path, false);
        }
      }
    };
    walk(0, bytes.length, "", true);
    return res;
  });
}
