/**
 * examples/blog-ws/server.ts
 *
 * WebSocket-backed Cap'n Web server, with Effect at the boundary.
 *
 * Architecture (the pattern from "Effect at the boundary, capability at the wire"):
 *
 *     Cap'n Web method
 *       → decode JS input
 *       → ManagedRuntime.runPromise(effect)
 *       → encode return / failure / stream
 *
 *   - `Layer` injects the repos (UsersRepo, PostsRepo) once per process.
 *   - `ManagedRuntime` is the long-lived bridge between Cap'n Web's per-call
 *     Promise contract and Effect's fiber/scope model.
 *   - Each RpcTarget method body is a tiny adapter: `runPromise(effect)`.
 *   - Bulk fetch uses `Effect.all({ concurrency: "unbounded" })` so N data
 *     points run in ONE fiber inside ONE Promise instead of N fibers.
 *
 * Cap'n Web's `Stubify<Promise<U>> = Stubify<U>` unwraps server-side Promises
 * automatically, so the client's derived `RpcStub<BlogApi>` sees the awaited
 * shapes: `info(): User | null` on the wire even though the impl returns
 * `Promise<User | null>`.
 *
 * Run standalone:
 *   bunx tsx examples/blog-ws/server.ts
 */

import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import type { Post, PostEvent, User } from "./shared.ts";
import { WS_PATH, WS_PORT } from "./shared.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Service interfaces
// ─────────────────────────────────────────────────────────────────────────────

class UsersRepo extends Context.Service<
  UsersRepo,
  {
    readonly find: (id: string) => Effect.Effect<User | null>;
  }
>()("blog/UsersRepo") {}

class PostsRepo extends Context.Service<
  PostsRepo,
  {
    readonly all: Effect.Effect<ReadonlyArray<Post>>;
    readonly byIds: (
      ids: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<Post>, "not found">;
    readonly create: (
      authorId: string,
      title: string,
    ) => Effect.Effect<Post, "already exists">;
    readonly remove: (id: string) => Effect.Effect<boolean, "not found">;
    readonly subscribe: (
      sub: (event: PostEvent) => void,
    ) => Effect.Effect<() => void, "already subscribed">;
  }
>()("blog/PostsRepo") {}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory implementations
// ─────────────────────────────────────────────────────────────────────────────

const SEED_USERS: User[] = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Linus" },
];

const SEED_POSTS: Post[] = [
  { id: "p1", title: "Effect in prod", authorId: "u1" },
  { id: "p2", title: "Typesafe APIs", authorId: "u1" },
  { id: "p3", title: "Zero-cost schemas", authorId: "u2" },
];

let rpcCount = 0;
const log = (label: string) => {
  rpcCount++;
  console.log(`[server RPC #${rpcCount}] ${label}`);
};

const UsersRepoLive = Layer.sync(UsersRepo, () => {
  const users: User[] = [...SEED_USERS];
  return {
    find: (id) =>
      Effect.sync(() => {
        log(`UsersRepo.find(${id})`);
        return users.find((u) => u.id === id) ?? null;
      }),
  };
});

const PostsRepoLive = Layer.sync(PostsRepo, () => {
  const posts: Post[] = [...SEED_POSTS];
  let nextId = posts.length + 1;
  const subscribers = new Set<(event: PostEvent) => void>();
  const broadcast = (event: PostEvent) => {
    for (const sub of subscribers) sub(event);
  };

  return {
    all: Effect.sync(() => [...posts]),

    // The architectural answer to "N data points in one round trip": Effect.all
    // inside a single runPromise = one fiber that drives N concurrent sub-effects.
    byIds: (ids) =>
      Effect.gen(function* () {
        log(
          `PostsRepo.byIds([${ids.join(", ")}]) — Effect.all over ${ids.length} ids`,
        );
        const results = yield* Effect.all(
          ids.map((id) => Effect.sync(() => posts.find((p) => p.id === id))),
          { concurrency: "unbounded" },
        );
        return results.filter((p): p is Post => p != null);
      }),

    create: (authorId, title) =>
      Effect.sync(() => {
        log(`PostsRepo.create(${authorId}, "${title}")`);
        const post: Post = { id: `p${nextId++}`, title, authorId };
        posts.push(post);
        broadcast({ _tag: "PostUpserted", post });
        return post;
      }),

    remove: (id) =>
      Effect.sync(() => {
        log(`PostsRepo.remove(${id})`);
        const idx = posts.findIndex((p) => p.id === id);
        if (idx === -1) return false;
        posts.splice(idx, 1);
        broadcast({ _tag: "PostRemoved", id });
        return true;
      }),

    subscribe: (sub) =>
      Effect.sync(() => {
        subscribers.add(sub);
        return () => {
          subscribers.delete(sub);
        };
      }),
  };
});

const AppLayer = Layer.mergeAll(UsersRepoLive, PostsRepoLive);

// One ManagedRuntime per process — repos live for the server's lifetime.
const appRuntime = ManagedRuntime.make(AppLayer);

// ─────────────────────────────────────────────────────────────────────────────
// RpcTarget classes — thin adapters that delegate to Effect via runPromise
// ─────────────────────────────────────────────────────────────────────────────

class UserHandle extends RpcTarget {
  #userId: string;
  constructor(id: string) {
    super();
    this.#userId = id;
  }

  info(): Promise<User | null> {
    return appRuntime.runPromise(
      Effect.flatMap(UsersRepo, (repo) => repo.find(this.#userId)),
    );
  }
}

export class BlogApi extends RpcTarget {
  user(id: string): UserHandle {
    return new UserHandle(id);
  }

  // Bulk fetch: ONE Promise, ONE fiber, N concurrent sub-effects via Effect.all.
  postsByIds(ids: ReadonlyArray<string>) {
    return appRuntime.runPromiseExit(
      Effect.flatMap(PostsRepo, (repo) => repo.byIds(ids)),
    );
  }

  // Streaming endpoint — initial snapshot + live subscription, both via the repo.
  // The ReadableStream lifecycle owns its subscriber; cancellation calls the
  // unsubscribe fn returned by repo.subscribe.
  watchPosts(): ReadableStream<PostEvent> {
    log("watchPosts() — stream opened");
    let unsub: (() => void) | null = null;
    return new ReadableStream<PostEvent>({
      start: async (controller) => {
        const initial = await appRuntime.runPromise(
          Effect.flatMap(PostsRepo, (repo) => repo.all),
        );
        for (const post of initial)
          controller.enqueue({ _tag: "PostUpserted", post });

        unsub = await appRuntime.runPromise(
          Effect.flatMap(PostsRepo, (repo) =>
            repo.subscribe((event) => {
              try {
                controller.enqueue(event);
              } catch {
                /* closed */
              }
            }),
          ),
        );
      },
      cancel: () => {
        if (unsub) unsub();
      },
    });
  }

  createPost(authorId: string, title: string): Promise<Post> {
    return appRuntime.runPromise(
      Effect.flatMap(PostsRepo, (repo) => repo.create(authorId, title)),
    );
  }

  removePost(id: string): Promise<boolean> {
    return appRuntime.runPromise(
      Effect.flatMap(PostsRepo, (repo) => repo.remove(id)),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP + WebSocket server
// ─────────────────────────────────────────────────────────────────────────────

export interface ServerHandle {
  readonly close: () => Promise<void>;
}

export const start = (): Promise<ServerHandle> =>
  new Promise<ServerHandle>((resolve) => {
    const httpServer = createServer((_req, res) => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not Found");
    });

    const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

    wss.on("connection", (ws) => {
      console.log("[server] WebSocket connection established");
      newWebSocketRpcSession(ws as unknown as WebSocket, new BlogApi());
      ws.on("close", () => console.log("[server] WebSocket connection closed"));
    });

    httpServer.listen(WS_PORT, () => {
      console.log(`[server] listening on ws://localhost:${WS_PORT}${WS_PATH}`);
      resolve({
        close: async () => {
          await new Promise<void>((r) =>
            wss.close(() => httpServer.close(() => r())),
          );
          await appRuntime.dispose();
          console.log("[server] runtime disposed");
        },
      });
    });
  });

if (import.meta.main) {
  void start().then(() => {
    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));
  });
}
