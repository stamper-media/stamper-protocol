// Dev mock storage provider: serves MOCK_SP_DIR/<pieceCid> at /piece/<pieceCid> via @stamper/foc.
// Runs inside the dev compose `mock-sp` container with the repository mounted read-only at /repo.
import { startPieceServer } from "../../packages/foc/dist/sp-server.js";

const dir = process.env.MOCK_SP_DIR ?? "/data";
const port = Number(process.env.MOCK_SP_PORT ?? "7878");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`mock-sp: invalid MOCK_SP_PORT ${process.env.MOCK_SP_PORT}`);
  process.exit(2);
}

const server = await startPieceServer({ dir, port, host: "0.0.0.0" });
console.log(`mock-sp: serving ${dir} on :${port}`);
const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
