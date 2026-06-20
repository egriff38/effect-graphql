/**
 * examples/blog-ws/main.ts
 *
 * One-shot orchestrator: starts the WebSocket server in this process, runs
 * the client demo, then shuts the server down.
 *
 * For a more realistic two-process setup, run server.ts and client.ts in
 * separate terminals instead:
 *
 *   bunx tsx examples/blog-ws/server.ts
 *   bunx tsx examples/blog-ws/client.ts
 *
 * Run this file:
 *   bunx tsx examples/blog-ws/main.ts
 */

import { runDemo } from "./client.ts";
import { start } from "./server.ts";

const main = async (): Promise<void> => {
  const server = await start();
  try {
    await runDemo();
  } finally {
    await server.close();
    console.log("[main] server stopped");
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
