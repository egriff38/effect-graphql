/**
 * examples/blog-ws/shared.ts
 *
 * Shared between client and server: DTOs, event types, connection config.
 *
 * The RPC contract is the server's class itself — NOT a duplicated interface.
 * The client derives its stub type via a type-only import:
 *
 *   import type { BlogApi } from "./server.ts"
 *   const stub = newWebSocketRpcSession<BlogApi>(WS_URL)
 *
 * `import type` is erased at runtime, so there is no module cycle even
 * though the client now references server.ts at the type level. Cap'n Web's
 * `Stubify<T>` rewrites the class's synchronous return types into
 * `RpcPromise<…>` automatically, so the server class doubles as the wire
 * contract.
 *
 * Shape inspired by the comlink pattern:
 *   `wrap<typeof import("./worker").API>(new Worker("./worker.ts"))`
 */

// ─────────────────────────────────────────────────────────────────────────────
// DTOs
// ─────────────────────────────────────────────────────────────────────────────

export interface User {
  readonly id: string;
  readonly name: string;
}

export interface Post {
  readonly id: string;
  readonly title: string;
  readonly authorId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event union for the watchPosts stream
// ─────────────────────────────────────────────────────────────────────────────

export type PostEvent =
  | { readonly _tag: "PostUpserted"; readonly post: Post }
  | { readonly _tag: "PostRemoved"; readonly id: string };


// ─────────────────────────────────────────────────────────────────────────────
// Connection config
// ─────────────────────────────────────────────────────────────────────────────

export const WS_PORT = 8787;
export const WS_PATH = "/api";
export const WS_URL = `ws://localhost:${WS_PORT}${WS_PATH}`;
