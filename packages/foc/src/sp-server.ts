import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import * as Piece from "@filoz/synapse-core/piece";

/** Parse a path segment as a canonical PieceCID string; null if it is not one (blocks traversal). */
export function canonicalPieceCid(s: string): string | null {
  const cid = Piece.tryFrom(s);
  return cid && cid.toString() === s ? s : null;
}

export type PieceServer = { server: Server; baseUrl: string; port: number; close(): Promise<void> };

/** Minimal SP retrieval endpoint: GET|HEAD /piece/<cid> serves <dir>/<cid>. */
export async function startPieceServer(opts: {
  dir: string;
  port: number;
  host?: string;
}): Promise<PieceServer> {
  const host = opts.host ?? "127.0.0.1";
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
        return;
      }
      const m = /^\/piece\/([^/]+)$/.exec(url.pathname);
      const cid = m?.[1] ? canonicalPieceCid(decodeURIComponent(m[1])) : null;
      if (!cid) {
        res.writeHead(404).end();
        return;
      }
      const path = join(opts.dir, cid);
      const st = await stat(path).catch(() => null);
      if (!st?.isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(st.size),
        "cache-control": "public, max-age=31536000, immutable",
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const rs = createReadStream(path);
      rs.on("error", () => res.destroy());
      rs.pipe(res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, host, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const shownHost = host === "0.0.0.0" || host === "127.0.0.1" ? "localhost" : host;
  return {
    server,
    port,
    baseUrl: `http://${shownHost}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
