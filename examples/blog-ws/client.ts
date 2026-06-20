/**
 * examples/blog-ws/client.ts
 *
 * Cap'n Web client over WebSocket, consumed through Effect atoms.
 *
 * Demonstrates the same three patterns as blog-capnweb-atoms.ts, but the
 * transport is now a real WebSocket connection — the only thing that changes
 * compared to MessageChannel is `newWebSocketRpcSession(WS_URL)` instead of
 * `newMessagePortRpcSession(port)`. Atom semantics are unchanged.
 *
 * Run standalone (server must already be running on WS_PORT):
 *   bunx tsx examples/blog-ws/client.ts
 *
 * Or import { runDemo } and orchestrate from main.ts.
 */

import { Context, Effect, Layer, Stream } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { newWebSocketRpcSession } from "capnweb";
import type { RpcStub } from "capnweb";
// Type-only import: erased at runtime, so no module cycle.
// The server class IS the contract — RpcStub<BlogApi> derives the wire surface.
import type { BlogApi } from "./server.ts";
import type { Post, PostEvent } from "./shared.ts";
import { WS_URL } from "./shared.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Cap'n Web stub + Effect Service
// ─────────────────────────────────────────────────────────────────────────────

// `newWebSocketRpcSession<T>(urlString)` connects asynchronously; method calls
// on the returned stub are queued until the socket is open.
const stub = newWebSocketRpcSession<BlogApi>(WS_URL);

// Effect Service whose Shape is the stub's wire interface (Promise-returning).
class BlogStub extends Context.Service<BlogStub, RpcStub<BlogApi>>()(
  "BlogStub",
) {}
const BlogStubLayer = Layer.succeed(BlogStub, stub);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Atoms
// ─────────────────────────────────────────────────────────────────────────────

const runtime = Atom.runtime(BlogStubLayer);

// Pattern 1 — parametric cache (Atom.family memoizes per id).
const userAtom = Atom.family((id: string) =>
  runtime.atom(
    Effect.flatMap(BlogStub, (s) => Effect.promise(() => s.user(id).info())),
  ),
);

// Pattern 2 — bulk fetch. Plain ReadonlyArray<string> key works because Effect 4
// uses structural equality by default in MutableHashMap.
const postsByIdsAtom = Atom.family((ids: ReadonlyArray<string>) =>
  runtime.atom(
    Effect.flatMap(BlogStub, (s) =>
      Effect.promise(() => s.postsByIds([...ids])),
    ),
  ),
);

// Pattern 3 — streaming-fold. ONE WebSocket-backed stream → ONE atom.
const applyEvent = (
  state: ReadonlyArray<Post>,
  event: PostEvent,
): ReadonlyArray<Post> => {
  switch (event._tag) {
    case "PostUpserted":
      return state.some((p) => p.id === event.post.id)
        ? state.map((p) => (p.id === event.post.id ? event.post : p))
        : [...state, event.post];
    case "PostRemoved":
      return state.filter((p) => p.id !== event.id);
  }
};

const livePostsAtom = runtime.atom(
  Stream.unwrap(
    Effect.flatMap(BlogStub, (s) =>
      // s.watchPosts() returns RpcPromise<ReadableStream<PostEvent>> — await first.
      Effect.map(
        Effect.promise(
          () => s.watchPosts() as unknown as Promise<ReadableStream<PostEvent>>,
        ),
        (readable) =>
          Stream.fromReadableStream<PostEvent, Error>({
            evaluate: () => readable,
            onError: (cause) => new Error(`stream: ${String(cause)}`),
          }),
      ),
    ),
  ).pipe(Stream.scan([] as ReadonlyArray<Post>, applyEvent)),
);

const createPostFn = runtime.fn((input: { authorId: string; title: string }) =>
  Effect.flatMap(BlogStub, (s) =>
    Effect.promise(() => s.createPost(input.authorId, input.title)),
  ),
);

const removePostFn = runtime.fn((id: string) =>
  Effect.flatMap(BlogStub, (s) => Effect.promise(() => s.removePost(id))),
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Demo runner
// ─────────────────────────────────────────────────────────────────────────────

const hr = () => console.log("─".repeat(64));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const printAsync = <A, E>(
  label: string,
  result: AsyncResult.AsyncResult<A, E>,
): void => {
  AsyncResult.match(result, {
    onInitial: () => console.log(`  ${label}: <initial>`),
    onSuccess: (s) => console.log(`  ${label}: ${JSON.stringify(s.value)}`),
    onFailure: (f) => console.log(`  ${label}: <failure>`, f.cause),
  });
};

export const runDemo = async (): Promise<void> => {
  const registry = AtomRegistry.make();

  try {
    // ── STAGE 1 — parametric cache ───────────────────────────────────────
    hr();
    console.log("STAGE 1 — Atom.family parametric cache");
    hr();

    const u1 = userAtom("u1");
    console.log(
      `  Atom identity: userAtom("u1") === userAtom("u1") → ${u1 === userAtom("u1")}`,
    );

    const unmountU1 = registry.mount(u1);
    await Effect.runPromise(AtomRegistry.getResult(registry, u1));
    printAsync("userAtom('u1')", registry.get(u1));

    await Effect.runPromise(AtomRegistry.getResult(registry, u1));
    console.log("  ↑ second read served from cache (no new RPC)");

    const u2 = userAtom("u2");
    const unmountU2 = registry.mount(u2);
    await Effect.runPromise(AtomRegistry.getResult(registry, u2));
    printAsync("userAtom('u2')", registry.get(u2));

    unmountU1();
    unmountU2();

    // ── STAGE 2 — bulk fetch ─────────────────────────────────────────────
    hr();
    console.log("STAGE 2 — bulk-fetch atom");
    hr();

    const bulk = postsByIdsAtom(["p1", "p2", "p3"]);
    console.log(
      `  Structural identity: postsByIdsAtom(['p1','p2','p3']) === postsByIdsAtom(['p1','p2','p3']) → ${bulk === postsByIdsAtom(["p1", "p2", "p3"])}`,
    );

    const unmountBulk = registry.mount(bulk);
    await Effect.runPromise(AtomRegistry.getResult(registry, bulk));
    printAsync("postsByIdsAtom(['p1','p2','p3'])", registry.get(bulk));

    unmountBulk();

    // ── STAGE 3 — streaming-fold ─────────────────────────────────────────
    hr();
    console.log("STAGE 3 — streaming-fold atom over WebSocket");
    hr();

    const states: Array<ReadonlyArray<Post>> = [];
    const unsubLive = registry.subscribe(
      livePostsAtom,
      (result) => {
        AsyncResult.match(result, {
          onInitial: () => {},
          onSuccess: (s) => {
            states.push(s.value);
            console.log(
              `  livePosts → [${s.value.map((p) => p.id).join(", ")}] (${s.value.length})`,
            );
          },
          onFailure: (f) => console.log(`  livePosts → FAILURE:`, f.cause),
        });
      },
      { immediate: true },
    );

    await sleep(200);

    console.log('\n  Mutation: createPost("u1", "WebSocket via atoms")');
    registry.set(createPostFn, {
      authorId: "u1",
      title: "WebSocket via atoms",
    });
    await sleep(200);

    console.log('\n  Mutation: removePost("p2")');
    registry.set(removePostFn, "p2");
    await sleep(200);

    console.log('\n  Mutation: createPost("u2", "Linus chimes in")');
    registry.set(createPostFn, { authorId: "u2", title: "Linus chimes in" });
    await sleep(200);

    unsubLive();

    hr();
    console.log(`Atom state transitions on livePostsAtom: ${states.length}`);
    hr();
  } finally {
    stub[Symbol.dispose]();
    registry.dispose();
  }
};

// Run standalone if invoked directly.
if (import.meta.main) {
  void runDemo().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
