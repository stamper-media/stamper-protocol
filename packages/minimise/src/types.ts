/** Camera facts that stay public after minimisation (shown in the record). */
export type PublicExif = {
  make?: string;
  model?: string;
  /** Exposure time as a photographer writes it, e.g. "1/120" or "2". */
  exposure?: string;
  iso?: number;
  /** Focal length with unit, e.g. "4.2 mm". */
  focalLength?: string;
};

/** What a minimiser removed and kept. Feeds the record's `sanitised` lists (DESIGN §3.4). */
export type MinimiseReport = {
  removed: string[];
  kept: string[];
  publicExif: PublicExif;
  orientation?: number;
  width?: number;
  height?: number;
};

export type MinimiseResult = { bytes: Uint8Array; report: MinimiseReport };

export type JpegInspection = {
  hasGps: boolean;
  hasSerial: boolean;
  hasMakerNote: boolean;
  hasXmp: boolean;
  orientation?: number;
  dims?: { w: number; h: number };
  segments: string[];
};

export type Mp4Inspection = { hasUdta: boolean; hasLocation: boolean; boxes: string[] };

export type SniffedType = "image/jpeg" | "video/mp4" | "video/quicktime" | "image/heic" | "unknown";

/** Random-access source for the streaming MP4 minimiser (a file handle, a Blob, an HTTP range reader). */
export interface ByteSource {
  /** Total length in bytes. */
  readonly size: number;
  /** Returns exactly `length` bytes starting at `offset` (fewer only at end of source). */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** Sequential sink for the streaming MP4 minimiser. Chunks are written in order. */
export interface ByteSink {
  write(chunk: Uint8Array): Promise<void> | void;
}
