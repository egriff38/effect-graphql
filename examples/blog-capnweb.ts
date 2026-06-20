/**
 * examples/blog-capnweb.ts
 *
 * The blog domain with Cap'n Web as the JS-native boundary and Effect as the
 * implementation layer.
 *
 * The key pattern here is the *object-capability graph*:
 *
 *   UserTarget ──── posts() ────► PostTarget[]
 *       ▲                             │
 *       └────────── author() ─────────┘
 *
 * Every navigation method returns an RpcTarget (a stub), so calls can be
 * chained without awaiting.  Cap'n Web batches the entire chain into one round
 * trip.  Terminal methods (.info(), .data()) return plain DTOs to end the chain.
 *
 * Example chains:
 *   await stub.authenticate("u1").me().info()           // 3 hops, 1 round trip
 *   await stub.authenticate("u1").me().posts()          // 4 hops, 1 round trip → PostTarget[]
 *   await stub.post("p1").author().info()               // cyclic traversal, 1 round trip
 *   await stub.post("p1").author().posts()              // deeper cyclic, 1 round trip → PostTarget[]
 *   await stub.post("p1").author().posts()
 *        .map(post => post.info())                      // deep traversal + fan-out, 1 round trip → Post[]
 *
 * Transport: MessageChannel (in-process; swap for HTTP/WebSocket in prod).
 *
 * Run:  bunx tsx examples/blog-capnweb.ts
 */

import { Effect, Layer, ManagedRuntime } from "effect";
import { newMessagePortRpcSession, RpcTarget } from "capnweb";

// ─────────────────────────────────────────────────────────────────────────────
// 1. DTO types
//
// Cap'n Web passes plain objects by value; Schema.Class instances are NOT
// serializable (they are application-defined classes, not RpcTarget).  In a
// real app that uses a Provider for GraphQL, Schema.Class lives server-side
// and is encoded into DTOs at each Cap'n Web return boundary.
// ─────────────────────────────────────────────────────────────────────────────

interface User     { readonly id: string; readonly name: string; }
interface Post     { readonly id: string; readonly title: string; readonly authorId: string; }
interface NotFound { readonly _tag: "NotFound"; readonly message: string; }
interface Forbidden { readonly _tag: "Forbidden"; readonly reason: string; }

// ─────────────────────────────────────────────────────────────────────────────
// 2. In-memory store
// ─────────────────────────────────────────────────────────────────────────────

const USERS: User[] = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Linus" },
];

const POSTS: Post[] = [
  { id: "p1", title: "Effect in prod",    authorId: "u1" },
  { id: "p2", title: "Typesafe APIs",     authorId: "u1" },
  { id: "p3", title: "Zero-cost schemas", authorId: "u2" },
];

// ─────────────────────────────────────────────────────────────────────────────
// 3. Result encoding
//
// No typed error channel in Cap'n Web.  Fold into a discriminated union so the
// client branches on _tag without try/catch.
// ─────────────────────────────────────────────────────────────────────────────

type Ok<A>  = { readonly _tag: "Ok";  readonly value: A };
type Err<E> = { readonly _tag: "Err"; readonly error: E };
type Result<A, E> = Ok<A> | Err<E>;

// Four+ call sites with identical fold semantics → extracted.
function toResult<A, E>(effect: Effect.Effect<A, E>): Effect.Effect<Result<A, E>> {
  return Effect.match(effect, {
    onFailure: (error) => ({ _tag: "Err" as const, error }),
    onSuccess: (value) => ({ _tag: "Ok"  as const, value }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Process-wide ManagedRuntime
// ─────────────────────────────────────────────────────────────────────────────

const appRuntime = ManagedRuntime.make(Layer.empty);

// ─────────────────────────────────────────────────────────────────────────────
// 5. Capability graph
//
// Navigation methods return RpcTarget instances — stubs on the client.
// Calling a method on a stub is another pipelined RPC, not a local call.
// Terminal methods return plain DTOs (by value) to end the chain.
//
// UserTarget.posts() and PostTarget.author() form a cycle, mirroring the
// GraphQL augmentations in blog.ts.
// ─────────────────────────────────────────────────────────────────────────────

class UserTarget extends RpcTarget {
  #userId: string;

  constructor(userId: string) {
    super();
    this.#userId = userId;
  }

  // Terminal — returns the user DTO.
  info(): Promise<Result<User, NotFound>> {
    const userId = this.#userId;
    return appRuntime.runPromise(toResult(
      Effect.gen(function*() {
        const user = USERS.find((u) => u.id === userId);
        if (!user) return yield* Effect.fail({ _tag: "NotFound" as const, message: `user ${userId} not found` });
        return user;
      }),
    ));
  }

  // Navigation — returns PostTarget stubs for further pipelining.
  // Synchronous: no async lookup needed; the capabilities are constructed
  // from the store immediately and passed by reference to the client.
  posts(): PostTarget[] {
    return POSTS
      .filter((p) => p.authorId === this.#userId)
      .map((p) => new PostTarget(p.id));
  }
}

class PostTarget extends RpcTarget {
  #postId: string;

  constructor(postId: string) {
    super();
    this.#postId = postId;
  }

  // Terminal — returns the post DTO.
  info(): Promise<Result<Post, NotFound>> {
    const postId = this.#postId;
    return appRuntime.runPromise(toResult(
      Effect.gen(function*() {
        const post = POSTS.find((p) => p.id === postId);
        if (!post) return yield* Effect.fail({ _tag: "NotFound" as const, message: `post ${postId} not found` });
        return post;
      }),
    ));
  }

  // Navigation — cyclic: returns a UserTarget (which itself has .posts()).
  author(): UserTarget {
    const post = POSTS.find((p) => p.id === this.#postId);
    return new UserTarget(post?.authorId ?? "");
  }
}

class AuthedBlogApi extends RpcTarget {
  #userId: string;

  constructor(userId: string) {
    super();
    this.#userId = userId;
  }

  // Navigation — returns a UserTarget for the authenticated user.
  // Synchronous; no Effect needed to construct the capability.
  me(): UserTarget {
    return new UserTarget(this.#userId);
  }

  // Mutation — returns a PostTarget stub so the caller can immediately
  // pipeline further calls on the newly-created post.
  createPost(title: string): Promise<Result<PostTarget, Forbidden>> {
    const userId = this.#userId;
    return appRuntime.runPromise(toResult(
      Effect.gen(function*() {
        const user = USERS.find((u) => u.id === userId);
        if (!user) return yield* Effect.fail({ _tag: "Forbidden" as const, reason: `unknown user ${userId}` });
        const post: Post = { id: `p${POSTS.length + 1}`, title, authorId: userId };
        POSTS.push(post);
        return new PostTarget(post.id);
      }),
    ));
  }
}

class BlogApi extends RpcTarget {
  // Auth in-band: returns the authenticated capability.
  authenticate(userId: string): AuthedBlogApi {
    return new AuthedBlogApi(userId);
  }

  // Public navigation: entry points into the graph.
  user(id: string): UserTarget { return new UserTarget(id); }
  post(id: string): PostTarget { return new PostTarget(id); }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Demo
// ─────────────────────────────────────────────────────────────────────────────

const hr = () => console.log("─".repeat(60));

const channel = new MessageChannel();
newMessagePortRpcSession(channel.port1, new BlogApi());
const stub = newMessagePortRpcSession<BlogApi>(channel.port2);

(async () => {
  try {
    hr();
    console.log("PIPELINING — authenticate + navigate in one round trip\n");

    // 3 hops, 1 round trip: authenticate → me → info
    const adaInfo = await stub.authenticate("u1").me().info();
    console.log("authenticate(u1).me().info():", JSON.stringify(adaInfo));

    // 4 hops, 1 round trip: authenticate → me → posts → (array of PostTarget stubs)
    const adaPostStubs = await stub.authenticate("u1").me().posts();
    console.log("authenticate(u1).me().posts() — stub count:", adaPostStubs.length);

    // Second round trip: batch all .info() calls for the stubs above.
    const adaPostData = await Promise.all(adaPostStubs.map((p) => p.info()));
    console.log("...each .info():", JSON.stringify(adaPostData));

    hr();
    console.log("MAP — full traversal in a single round trip\n");

    // auth + me + posts + (for each post) info — all batched into one HTTP request.
    const adaPostInfos = await stub.authenticate("u1").me().posts()
      .map((post) => post.info());
    console.log("authenticate(u1).me().posts().map(info):", JSON.stringify(adaPostInfos));

    hr();
    console.log("CYCLIC TRAVERSAL\n");

    // post.author().info() — 2 hops, 1 round trip
    const p3Author = await stub.post("p3").author().info();
    console.log("post(p3).author().info():", JSON.stringify(p3Author));

    // post.author().posts() — traverse two edges of the cycle, 1 round trip
    const linusPostStubs = await stub.post("p3").author().posts();
    console.log("post(p3).author().posts() — stub count:", linusPostStubs.length);

    // post.author().posts().map(info) — 1 round trip, returns all Linus's post DTOs
    const linusPostInfos = await stub.post("p3").author().posts()
      .map((post) => post.info());
    console.log("post(p3).author().posts().map(info):", JSON.stringify(linusPostInfos));

    hr();
    console.log("MUTATION — createPost returns a stub for immediate pipelining\n");

    // createPost returns Result<PostTarget, Forbidden>.
    // The PostTarget inside is a stub — .info() pipes straight onto it.
    const created = await stub.authenticate("u1").createPost("Cap'n Web Pipelining");
    if (created._tag === "Ok") {
      const newPostInfo = await created.value.info();
      console.log("createPost → .info():", JSON.stringify(newPostInfo));
      // Verify it appears in Ada's posts:
      const updatedCount = (await stub.authenticate("u1").me().posts()).length;
      console.log("authenticate(u1).me().posts() count after mutation:", updatedCount);
    }
  } finally {
    stub[Symbol.dispose]();
    await appRuntime.dispose();
  }
})().catch(console.error);
