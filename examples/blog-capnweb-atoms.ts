/**
 * examples/blog-capnweb-atoms.ts
 *
 * Effect atoms (effect/unstable/reactivity) on top of Cap'n Web at the boundary.
 *
 * Three patterns, each addressing a different angle of the N-fiber problem:
 *
 *   1. Atom.family parametric cache         — N reads with same param = 1 RPC
 *   2. Bulk-fetch atom (single Effect)      — N data points in 1 RPC, 1 fiber
 *   3. Streaming-fold atom (the big one)    — N events absorbed into 1 atom
 *
 * The streaming atom is the architectural answer: instead of N terminal
 * Promise calls, the server exposes a ReadableStream of events; the client
 * folds them into one atom via Stream.scan. Mutations elsewhere flow back
 * as events on the same stream — no per-event Promise boundary.
 *
 * Transport: MessageChannel (in-process). In production, swap for HTTP /
 * WebSocket — atom semantics are unchanged.
 *
 * Run:  bunx tsx examples/blog-capnweb-atoms.ts
 */

import { Context, Effect, Layer, Stream } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import type { RpcStub } from "capnweb";
import { newMessagePortRpcSession, RpcTarget } from "capnweb";

// ─────────────────────────────────────────────────────────────────────────────
// 1. DTOs
// ─────────────────────────────────────────────────────────────────────────────

interface User {
  readonly id: string;
  readonly name: string;
}
interface Post {
  readonly id: string;
  readonly title: string;
  readonly authorId: string;
}

type PostEvent =
  | { readonly _tag: "PostUpserted"; readonly post: Post }
  | { readonly _tag: "PostRemoved"; readonly id: string };

// ─────────────────────────────────────────────────────────────────────────────
// 2. In-memory store + change broadcast
// ─────────────────────────────────────────────────────────────────────────────

const USERS: User[] = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Linus" },
];

const POSTS: Post[] = [
  { id: "p1", title: "Effect in prod", authorId: "u1" },
  { id: "p2", title: "Typesafe APIs", authorId: "u1" },
  { id: "p3", title: "Zero-cost schemas", authorId: "u2" },
];

// Server-side fan-out: each watchPosts() subscriber is registered here.
// Mutations broadcast events to all subscribers.
const subscribers = new Set<(event: PostEvent) => void>();
const broadcast = (event: PostEvent) => {
  for (const sub of subscribers) sub(event);
};

// Server-side RPC accounting. Lets us SEE that the cache pattern eliminates
// duplicate RPCs and that bulk fetch is one call.
let rpcCount = 0;
const tag = (label: string) => {
  rpcCount++;
  console.log(`    [server RPC #${rpcCount}] ${label}`);
};

// Monotonic id allocator — POSTS.length + 1 reuses ids after removal.
let nextPostId = POSTS.length + 1; // first new post = p4

// ─────────────────────────────────────────────────────────────────────────────
// 3. Server-side RpcTargets
// ─────────────────────────────────────────────────────────────────────────────

class UserTarget extends RpcTarget {
  #userId: string;
  constructor(id: string) {
    super();
    this.#userId = id;
  }

  info(): User | null {
    tag(`user(${this.#userId}).info()`);
    return USERS.find((u) => u.id === this.#userId) ?? null;
  }
}

class BlogApi extends RpcTarget {
  user(id: string): UserTarget {
    return new UserTarget(id);
  }

  // Bulk fetch — Effect.all-style: one method, one fiber, N data points.
  postsByIds(ids: ReadonlyArray<string>): Post[] {
    tag(`postsByIds([${ids.join(", ")}])  ← single fiber for N posts`);
    return ids
      .map((id) => POSTS.find((p) => p.id === id))
      .filter((p): p is Post => p != null);
  }

  // Streaming subscription: ONE call returns a live event stream.
  // The client folds it into one atom — N events become 1 cumulative state.
  watchPosts(): ReadableStream<PostEvent> {
    tag("watchPosts()  ← stream opened (counts as one RPC for the lifetime)");
    let sub: ((event: PostEvent) => void) | null = null;
    return new ReadableStream<PostEvent>({
      start(controller) {
        // Initial snapshot — emit current posts as PostUpserted events.
        for (const post of POSTS)
          controller.enqueue({ _tag: "PostUpserted", post });
        // Subsequent mutations.
        sub = (event) => {
          try {
            controller.enqueue(event);
          } catch {
            /* closed */
          }
        };
        subscribers.add(sub);
      },
      cancel() {
        if (sub) subscribers.delete(sub);
      },
    });
  }

  createPost(authorId: string, title: string): Post {
    tag(`createPost(${authorId}, "${title}")`);
    const post: Post = { id: `p${nextPostId++}`, title, authorId };
    POSTS.push(post);
    broadcast({ _tag: "PostUpserted", post });
    return post;
  }

  removePost(id: string): boolean {
    tag(`removePost(${id})`);
    const idx = POSTS.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    POSTS.splice(idx, 1);
    broadcast({ _tag: "PostRemoved", id });
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Wire Cap'n Web
// ─────────────────────────────────────────────────────────────────────────────

const channel = new MessageChannel();
newMessagePortRpcSession(channel.port1, new BlogApi());
const stub = newMessagePortRpcSession<BlogApi>(channel.port2);

// Service whose Shape is RpcStub<BlogApi> — method results are RpcPromise<…>
// (which extends Promise), so Effect.promise can consume them directly.
class BlogStub extends Context.Service<BlogStub, RpcStub<BlogApi>>()(
  "BlogStub",
) {}
const BlogStubLayer = Layer.succeed(BlogStub, stub);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Atom runtime + atoms
// ─────────────────────────────────────────────────────────────────────────────

const runtime = Atom.runtime(BlogStubLayer);

// Pattern 1 — parametric cache.
//
// Atom.family memoizes by argument. Identical args → identical atom →
// the registry serves cached state on re-read with no second RPC.
const userAtom = Atom.family((id: string) =>
  runtime.atom(
    Effect.flatMap(BlogStub, (s) => Effect.promise(() => s.user(id).info())),
  ),
);

// Pattern 2 — bulk fetch.
//
// In Effect 4, Equal.equals uses structural equality by default; plain
// ReadonlyArray<string> keys dedupe naturally — no Data.array wrapping.
const postsByIdsAtom = Atom.family((ids: ReadonlyArray<string>) =>
  runtime.atom(
    Effect.flatMap(BlogStub, (s) =>
      Effect.promise(() => s.postsByIds([...ids])),
    ),
  ),
);

// Pattern 3 — streaming-fold.
//
// Server returns ReadableStream<PostEvent>; client wraps it as an Effect Stream
// and folds via Stream.scan. ONE atom holds the cumulative state. Mutations
// elsewhere flow back as events. UI subscribes once and never sees a Promise.
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
      // s.watchPosts() returns an RpcPromise<ReadableStream<PostEvent>> — must
      // be awaited before passing the ReadableStream to fromReadableStream.
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

// Mutations as runtime.fn — write the arg into the atom to invoke.
const createPostFn = runtime.fn((input: { authorId: string; title: string }) =>
  Effect.flatMap(BlogStub, (s) =>
    Effect.promise(() => s.createPost(input.authorId, input.title)),
  ),
);

const removePostFn = runtime.fn((id: string) =>
  Effect.flatMap(BlogStub, (s) => Effect.promise(() => s.removePost(id))),
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Demo
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
    onFailure: () => console.log(`  ${label}: <failure>`),
  });
};

const registry = AtomRegistry.make();

const main = async () => {
  // ── STAGE 1 — parametric cache ─────────────────────────────────────────
  hr();
  console.log(
    "STAGE 1 — Atom.family parametric cache (read same key = no extra RPC)",
  );
  hr();

  const u1 = userAtom("u1");
  const u1Again = userAtom("u1");
  console.log(
    `  Atom.family identity:  userAtom("u1") === userAtom("u1")  →  ${u1 === u1Again}`,
  );

  // Mounting subscribes the registry; the atom runs its effect once.
  const unmountU1 = registry.mount(u1);
  await Effect.runPromise(AtomRegistry.getResult(registry, u1));
  printAsync("userAtom('u1')", registry.get(u1));

  // Read again — cached.
  await Effect.runPromise(AtomRegistry.getResult(registry, u1));
  console.log("  ↑ second read of same atom served from cache (no new RPC)");

  // Different param → different atom → server hit.
  const u2 = userAtom("u2");
  const unmountU2 = registry.mount(u2);
  await Effect.runPromise(AtomRegistry.getResult(registry, u2));
  printAsync("userAtom('u2')", registry.get(u2));

  unmountU1();
  unmountU2();

  // ── STAGE 2 — bulk fetch ───────────────────────────────────────────────
  hr();
  console.log("STAGE 2 — bulk-fetch atom (N posts in 1 RPC, 1 fiber)");
  hr();

  // Plain array key — Effect 4's structural equality means identical contents
  // produce the same atom from Atom.family.
  const bulk = postsByIdsAtom(["p1", "p2", "p3"]);
  const bulkAgain = postsByIdsAtom(["p1", "p2", "p3"]);
  console.log(
    `  postsByIdsAtom(['p1','p2','p3']) identity (structural):  ${bulk === bulkAgain}`,
  );

  const unmountBulk = registry.mount(bulk);
  await Effect.runPromise(AtomRegistry.getResult(registry, bulk));
  await Effect.runPromise(AtomRegistry.getResult(registry, bulkAgain));
  printAsync("postsByIdsAtom(['p1','p2','p3'])", registry.get(bulk));

  unmountBulk();

  // ── STAGE 3 — streaming-fold ───────────────────────────────────────────
  hr();
  console.log("STAGE 3 — streaming-fold atom (one stream, one atom, N events)");
  hr();
  console.log("  Subscribing to livePostsAtom...");

  const states: Array<ReadonlyArray<Post>> = [];
  const unsubLive = registry.subscribe(
    livePostsAtom,
    (result) => {
      AsyncResult.match(result, {
        onInitial: () => {},
        onSuccess: (s) => {
          states.push(s.value);
          console.log(
            `  livePosts → [${s.value.map((p) => p.id).join(", ")}]  (${s.value.length} posts)`,
          );
        },
        onFailure: (f) => console.log(`  livePosts → FAILURE:`, f.cause),
      });
    },
    { immediate: true },
  );

  // The mount + subscribe activates the stream; let initial events flush.
  await sleep(150);

  console.log('\n  Mutation: createPost("u1", "Streaming via atoms")');
  registry.set(createPostFn, { authorId: "u1", title: "Streaming via atoms" });
  await sleep(150);

  console.log('\n  Mutation: removePost("p2")');
  registry.set(removePostFn, "p2");
  await sleep(150);

  console.log('\n  Mutation: createPost("u2", "Linus chimes in")');
  registry.set(createPostFn, { authorId: "u2", title: "Linus chimes in" });
  await sleep(150);

  unsubLive();

  hr();
  console.log(`Total server RPC operations: ${rpcCount}`);
  console.log(
    `Atom state transitions observed on livePostsAtom: ${states.length}`,
  );
  hr();
};

main()
  .catch(console.error)
  .finally(() => {
    stub[Symbol.dispose]();
    registry.dispose();
  });
