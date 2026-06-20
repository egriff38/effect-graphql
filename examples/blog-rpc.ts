/**
 * examples/blog-rpc.ts
 *
 * The same blog domain as blog.ts, implemented with pure Effect RPC.
 * No GraphQL, no Provider — just Rpc / RpcGroup / handlers / RpcTest.
 *
 * The key difference from blog.ts: the RpcGroup is fully typed here, so
 * RpcTest.makeClient returns a per-tag typed client with no casts needed.
 * Typed errors surface as Effect failures (not as GraphQL union members).
 *
 * Run:  bunx tsx examples/blog-rpc.ts
 */

import { Effect, Schema } from "effect";
import { Rpc, RpcGroup, RpcTest } from "effect/unstable/rpc";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Schema types (same shape as blog.ts)
// ─────────────────────────────────────────────────────────────────────────────

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

class Post extends Schema.Class<Post>("Post")({
  id: Schema.String,
  title: Schema.String,
  authorId: Schema.String,
}) {}

class NotFound extends Schema.Class<NotFound>("NotFound")({
  _tag: Schema.Literal("NotFound"),
  message: Schema.String,
}) {}

class Forbidden extends Schema.Class<Forbidden>("Forbidden")({
  _tag: Schema.Literal("Forbidden"),
  reason: Schema.String,
}) {}

// ─────────────────────────────────────────────────────────────────────────────
// 2. In-memory store
// ─────────────────────────────────────────────────────────────────────────────

const USERS: User[] = [
  new User({ id: "u1", name: "Ada" }),
  new User({ id: "u2", name: "Linus" }),
];

const POSTS: Post[] = [
  new Post({ id: "p1", title: "Effect in prod", authorId: "u1" }),
  new Post({ id: "p2", title: "Typesafe APIs", authorId: "u1" }),
  new Post({ id: "p3", title: "Zero-cost schemas", authorId: "u2" }),
];

// ─────────────────────────────────────────────────────────────────────────────
// 3. RPC definitions
//
// Augmentations don't exist in pure RPC — relationship lookups become explicit
// top-level procedures (userPosts, postAuthor) that the caller invokes by id.
// ─────────────────────────────────────────────────────────────────────────────

const meRpc = Rpc.make("me", { success: User, error: Forbidden });
const userRpc = Rpc.make("user", { payload: { id: Schema.String }, success: User, error: NotFound });
const postsRpc = Rpc.make("posts", { success: Schema.Array(Post) });
const createPostRpc = Rpc.make("createPost", { payload: { title: Schema.String }, success: Post, error: Forbidden });
const userPostsRpc = Rpc.make("userPosts", { payload: { userId: Schema.String }, success: Schema.Array(Post) });
const postAuthorRpc = Rpc.make("postAuthor", { payload: { postId: Schema.String }, success: User, error: NotFound });

const group = RpcGroup.make(
  meRpc, userRpc, postsRpc, createPostRpc, userPostsRpc, postAuthorRpc,
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Handlers
//
// Each handler receives (payload, { headers, requestId, client }).
// Auth is read directly from headers — no per-request Layer needed.
// ─────────────────────────────────────────────────────────────────────────────

const handlersLayer = group.toLayer({
  me: (_, { headers }) =>
    Effect.gen(function*() {
      const userId = headers["x-user"];
      if (!userId) return yield* Effect.fail(new Forbidden({ _tag: "Forbidden", reason: "not authenticated" }));
      const user = USERS.find((u) => u.id === userId);
      if (!user) return yield* Effect.fail(new Forbidden({ _tag: "Forbidden", reason: `unknown user ${userId}` }));
      return user;
    }),

  user: ({ id }) => {
    const user = USERS.find((u) => u.id === id);
    return user
      ? Effect.succeed(user)
      : Effect.fail(new NotFound({ _tag: "NotFound", message: `user ${id} not found` }));
  },

  posts: () => Effect.succeed(POSTS),

  createPost: ({ title }, { headers }) =>
    Effect.gen(function*() {
      const userId = headers["x-user"];
      if (!userId) return yield* Effect.fail(new Forbidden({ _tag: "Forbidden", reason: "not authenticated" }));
      const post = new Post({ id: `p${POSTS.length + 1}`, title, authorId: userId });
      POSTS.push(post);
      return post;
    }),

  userPosts: ({ userId }) => Effect.succeed(POSTS.filter((p) => p.authorId === userId)),

  postAuthor: ({ postId }) => {
    const post = POSTS.find((p) => p.id === postId);
    if (!post) return Effect.fail(new NotFound({ _tag: "NotFound", message: `post ${postId} not found` }));
    const user = USERS.find((u) => u.id === post.authorId);
    return user
      ? Effect.succeed(user)
      : Effect.fail(new NotFound({ _tag: "NotFound", message: `author ${post.authorId} not found` }));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Demo
// ─────────────────────────────────────────────────────────────────────────────

const hr = () => console.log("─".repeat(60));

const demo = Effect.gen(function*() {
  // RpcTest wires the client directly to the handlers layer — no HTTP, no
  // serialization.  Because the group is fully typed (not erased), makeClient
  // returns a per-tag typed client: no casts, no unknown.
  const client = yield* RpcTest.makeClient(group);

  hr();
  console.log("QUERIES\n");

  // me — success.
  const me = yield* client.me(undefined, { headers: { "x-user": "u1" } });
  console.log("me (x-user: u1):", JSON.stringify(me));

  // me — Forbidden failure (no header).
  const noAuth = yield* Effect.exit(client.me(undefined, {}));
  console.log("me (no auth) — Exit:", JSON.stringify(noAuth));

  // user — success.
  const user = yield* client.user({ id: "u1" }, {});
  console.log("user(u1):", JSON.stringify(user));

  // user — NotFound failure.
  const missing = yield* Effect.exit(client.user({ id: "u99" }, {}));
  console.log("user(u99) — Exit:", JSON.stringify(missing));

  // posts — full list.
  const posts = yield* client.posts(undefined, {});
  console.log("posts:", JSON.stringify(posts));

  hr();
  console.log("MUTATIONS\n");

  // createPost — success.
  const created = yield* client.createPost({ title: "Effect RPC" }, { headers: { "x-user": "u2" } });
  console.log("createPost (u2):", JSON.stringify(created));

  // createPost — Forbidden (no auth).
  const denied = yield* Effect.exit(client.createPost({ title: "sneaky" }, {}));
  console.log("createPost (no auth) — Exit:", JSON.stringify(denied));

  hr();
  console.log("RELATIONSHIP LOOKUPS\n");

  // userPosts — Ada's posts.
  const adaPosts = yield* client.userPosts({ userId: "u1" }, {});
  console.log("userPosts(u1):", JSON.stringify(adaPosts));

  // postAuthor — who wrote p3?
  const author = yield* client.postAuthor({ postId: "p3" }, {});
  console.log("postAuthor(p3):", JSON.stringify(author));

  // postAuthor — NotFound for a missing post.
  const badPost = yield* Effect.exit(client.postAuthor({ postId: "p99" }, {}));
  console.log("postAuthor(p99) — Exit:", JSON.stringify(badPost));
}).pipe(
  Effect.scoped,
  Effect.provide(handlersLayer),
);

Effect.runPromise(demo).then(() => {
  hr();
  console.log("done");
}).catch(console.error);
