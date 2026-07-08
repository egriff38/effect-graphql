/**
 * examples/blog.ts
 *
 * A self-contained blog API that demonstrates everything the library offers:
 *
 *   1. Schema types (Schema.Class)
 *   2. A request Layer that derives auth from incoming headers
 *   3. Root operations: queries + a mutation
 *   4. Typed errors-as-data (result unions)
 *   5. Authorization guards
 *   6. Augmentations (relationship fields) with a tick-batched Loader
 *   7. Both transports running against the SAME Provider:
 *      - GraphQL via `Executor.make`  (effect-platform adapter)
 *      - RPC    via `Provider.rpcHandlersLayer` + `RpcTest.makeClient`
 *
 * Run:  bunx tsx examples/blog.ts
 */

import { Context, Effect, Layer, Schema } from "effect";
import { Rpc, RpcTest } from "effect/unstable/rpc";
import { printSchema } from "graphql";
import * as GraphQL from "../packages/core/src/index.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Schema types
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

// Typed errors surfaced as union members in GraphQL (not `errors[]`) and as
// typed failures over RPC.

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
// 3. Services
// ─────────────────────────────────────────────────────────────────────────────

// Auth is derived from the request header in the request Layer below.
class Auth extends Context.Service<Auth, { readonly userId: string }>()(
  "blog/Auth",
) {}

// Tick-batched loader for resolving posts by authorId in augmentations.
class PostsByAuthorLoader extends Context.Service<
  PostsByAuthorLoader,
  GraphQL.Loader.Loader<string, Post[]>
>()("blog/PostsByAuthorLoader") {}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Guards
// ─────────────────────────────────────────────────────────────────────────────

/** Fails with Forbidden when the caller is not authenticated (no x-user header). */
const requireAuth = Effect.gen(function* () {
  const { userId } = yield* Auth;
  if (!userId)
    yield* Effect.fail(
      new Forbidden({ _tag: "Forbidden", reason: "not authenticated" }),
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Provider
// ─────────────────────────────────────────────────────────────────────────────

export const provider = GraphQL.Provider.make({
  // App layer: services that live for the lifetime of the server process.
  app: Layer.empty,

  // Request layer: rebuilt per-request from ProviderRequest (headers, method, url, body).
  // Both the GraphQL adapter and the RPC bridge populate ProviderRequest, so this layer
  // is transport-agnostic.
  request: Layer.merge(
    // Auth: read the caller's identity from the request header.
    Layer.effect(Auth)(
      Effect.map(GraphQL.ProviderRequest, (req) => ({
        userId: req.headers["x-user"] ?? "",
      })),
    ),
    // PostsByAuthorLoader: a tick-batched loader that coalesces N author lookups
    // across sibling resolvers into a single batch call.
    Layer.effect(PostsByAuthorLoader)(
      GraphQL.Loader.make((authorIds: ReadonlyArray<string>) =>
        Effect.succeed(
          authorIds.map((id) => POSTS.filter((p) => p.authorId === id)),
        ),
      ),
    ),
  ),

  // Root queries.
  query: {
    // me — returns the currently authenticated user.
    me: GraphQL.Provider.field({
      rpc: Rpc.make("me", { success: User, error: Forbidden }),
      guards: [requireAuth],
      resolve: () =>
        Effect.gen(function* () {
          const { userId } = yield* Auth;
          // Guard already rejected unauthenticated callers; any valid userId maps to a user.
          const user = USERS.find((u) => u.id === userId);
          if (!user)
            yield* Effect.fail(
              new Forbidden({
                _tag: "Forbidden",
                reason: `unknown user ${userId}`,
              }),
            );
          return user!;
        }),
    }),

    // user — look up any user by id (public).
    user: GraphQL.Provider.field({
      rpc: Rpc.make("user", {
        payload: { id: Schema.String },
        success: User,
        error: NotFound,
      }),
      resolve: ({ id }) => {
        const user = USERS.find((u) => u.id === id);
        return user
          ? Effect.succeed(user)
          : Effect.fail(
              new NotFound({
                _tag: "NotFound",
                message: `user ${id} not found`,
              }),
            );
      },
    }),

    // posts — list all posts (public).
    posts: GraphQL.Provider.field({
      rpc: Rpc.make("posts", { success: Schema.Array(Post) }),
      resolve: () => Effect.succeed(POSTS),
    }),
  },

  // Root mutations.
  mutation: {
    // createPost — auth-gated; appends a new post and returns it.
    createPost: GraphQL.Provider.field({
      rpc: Rpc.make("createPost", {
        payload: { title: Schema.String },
        success: Post,
        error: Forbidden,
      }),
      guards: [requireAuth],
      resolve: ({ title }) =>
        Effect.gen(function* () {
          const { userId } = yield* Auth;
          const post = new Post({
            id: `p${POSTS.length + 1}`,
            title,
            authorId: userId,
          });
          POSTS.push(post);
          return post;
        }),
    }),
  },

  // Augmentations: relationship fields layered onto existing types.
  augmentations: [
    // Post.author — resolve the author of a post; batched across siblings.
    GraphQL.Provider.augment(
      Post,
      Rpc.make("author", { success: User, error: NotFound }),
      (post: Post) =>
        Effect.gen(function* () {
          const user = USERS.find((u) => u.id === post.authorId);
          return (
            user ??
            (yield* Effect.fail(
              new NotFound({
                _tag: "NotFound",
                message: `author ${post.authorId} not found`,
              }),
            ))
          );
        }),
    ),

    // User.posts — resolve all posts for a user; batched via PostsByAuthorLoader.
    GraphQL.Provider.augment(
      User,
      Rpc.make("posts", { success: Schema.Array(Post) }),
      (user) =>
        Effect.gen(function* () {
          const loader = yield* PostsByAuthorLoader;
          return yield* loader.load(user.id);
        }),
    ),
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Demo runner
// ─────────────────────────────────────────────────────────────────────────────

const hr = () => console.log("─".repeat(60));

const demo = Effect.gen(function* () {
  // ── Schema SDL ────────────────────────────────────────────────────────────
  hr();
  console.log("DERIVED GRAPHQL SCHEMA\n");
  console.log(printSchema(GraphQL.Provider.toSchema(provider)));

  // ── GraphQL transport ─────────────────────────────────────────────────────
  hr();
  console.log("GRAPHQL TRANSPORT\n");

  const executor = GraphQL.Executor.make(provider);
  const gql = (query: string, headers: Record<string, string> = {}) =>
    executor.execute({
      query,
      request: { method: "POST", url: "/graphql", headers, body: null },
    });

  // Unauthenticated `me` → Forbidden union member (not errors[]).
  const r1 = yield* Effect.promise(() =>
    gql(`{ me { __typename ... on Forbidden { reason } } }`),
  );
  console.log("me (no auth):", JSON.stringify(r1.data));

  // Authenticated `me`.
  const r2 = yield* Effect.promise(() =>
    gql(`{ me { __typename ... on User { id name } } }`, { "x-user": "u1" }),
  );
  console.log("me (x-user: u1):", JSON.stringify(r2.data));

  // user by id — missing → NotFound.
  const r3 = yield* Effect.promise(() =>
    gql(`{ user(id: "u99") { __typename ... on NotFound { message } } }`),
  );
  console.log("user(u99):", JSON.stringify(r3.data));

  // posts with augmented author — exercises N+1 batching across sibling resolvers.
  const r4 = yield* Effect.promise(() =>
    gql(`{ posts { title author { __typename ... on User { name } } } }`),
  );
  console.log("posts with author:", JSON.stringify(r4.data));

  // createPost mutation — auth-gated.
  const r5 = yield* Effect.promise(() =>
    gql(
      `mutation { createPost(title: "Effect RPC") { __typename ... on Post { id title } } }`,
      { "x-user": "u2" },
    ),
  );
  console.log("createPost (u2):", JSON.stringify(r5.data));

  // User.posts augmentation — resolver that uses the batched loader.
  const r6 = yield* Effect.promise(() =>
    gql(
      `{ user(id: "u1") { __typename ... on User { name posts { title } } } }`,
    ),
  );
  console.log("user.posts (u1):", JSON.stringify(r6.data));

  // ── RPC transport ─────────────────────────────────────────────────────────
  hr();
  console.log("RPC TRANSPORT  (same Provider, same request Layer)\n");

  // RpcGroup built from the Provider's root operations.
  const group = GraphQL.Provider.toRpcGroup(provider);
  console.log("RPC group tags:", [...group.requests.keys()].sort().join(", "));

  // In-memory RPC client backed by rpcHandlersLayer — no HTTP, no serialization.
  // The flatten form is required because the group is currently RpcGroup<Rpc.Any>
  // (per-tag typing is a follow-up; see issue #19).
  const rpcResult = yield* Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(group, { flatten: true });

    // Convenience cast: consequence of the erased RpcGroup<Rpc.Any> (follow-up: issue #19).
    type Call = (
      tag: string,
      payload: unknown,
      opts: { headers: Record<string, string> },
    ) => Effect.Effect<unknown, unknown>;
    const call = client as unknown as Call;

    // Root query through RPC — headers feed into the same request Layer.
    const me = yield* call("me", undefined, { headers: { "x-user": "u1" } });
    console.log("RPC me (x-user: u1):", JSON.stringify(me));

    // RPC typed errors are Effect *failures* (not data).  Use Effect.exit to inspect them.
    const notFound = yield* Effect.exit(
      call("user", { id: "u99" }, { headers: {} }),
    );
    console.log("RPC user(u99) — Exit:", JSON.stringify(notFound));

    // Unauthenticated me → Forbidden failure.
    const forbidden = yield* Effect.exit(
      call("me", undefined, { headers: {} }),
    );
    console.log("RPC me (no auth) — Exit:", JSON.stringify(forbidden));

    // Root query — posts list.
    const posts = yield* call("posts", undefined, { headers: {} });
    console.log("RPC posts count:", (posts as unknown[]).length);

    // Mutation through RPC.
    const created = yield* call(
      "createPost",
      { title: "RPC post" },
      { headers: { "x-user": "u2" } },
    );
    console.log("RPC createPost (u2):", JSON.stringify(created));

    return { me, notFound, forbidden, posts, created };
  }).pipe(
    Effect.scoped,
    Effect.provide(GraphQL.Provider.rpcHandlersLayer(provider)),
  );

  // Void the return so the outer demo Effect has no residual requirements.
  return void rpcResult;
});

Effect.runPromise(demo as Effect.Effect<void>)
  .then(() => {
    hr();
    console.log("done");
  })
  .catch(console.error);
