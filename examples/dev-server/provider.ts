/**
 * The Provider for the dev server. Wires:
 *
 *  - app layer: empty (no app-scoped services here; in production this is where
 *    DB pools and config Layers go)
 *  - request layer: Auth (from x-user header) + per-request `RequestResolver`s
 *    that coalesce N+1 augmentation lookups into one batch
 *  - root operations (queries + mutation)
 *  - augmentations on User, Post, and Comment forming a cyclic capability graph
 *    (User.posts → Post.author → User, Post.comments → Comment.post → Post, …)
 *
 * Batching pattern: for each many-to-one lookup, we declare a `Request` (a
 * plain data value describing "load X by id") and a `RequestResolver` service
 * that batches concurrent requests. Sibling resolver invocations in the same
 * tick get one call to the batching function.
 */

import { Context, Effect, Layer, Request, RequestResolver, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { Provider, ProviderRequest } from "../../packages/core/src/index.ts";
import {
  Comment,
  CreatePostInput,
  Forbidden,
  NotFound,
  Post,
  PostStatus,
  User,
} from "./domain.ts";
import { COMMENTS, createPost as storeCreatePost, POSTS, USERS } from "./store.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Request-scoped services
// ─────────────────────────────────────────────────────────────────────────────

class Auth extends Context.Service<Auth, { readonly userId: string | null }>()(
  "blog/Auth",
) {}

// Request definitions. Each Request<Success, Error, Services> declares one
// logical batched lookup.
interface LoadUser extends Request.Request<User | null> {
  readonly _tag: "LoadUser";
  readonly id: string;
}
const LoadUser = Request.tagged<LoadUser>("LoadUser");

interface LoadCommentsByPost extends Request.Request<ReadonlyArray<Comment>> {
  readonly _tag: "LoadCommentsByPost";
  readonly postId: string;
}
const LoadCommentsByPost = Request.tagged<LoadCommentsByPost>("LoadCommentsByPost");

interface LoadCommentsByUser extends Request.Request<ReadonlyArray<Comment>> {
  readonly _tag: "LoadCommentsByUser";
  readonly userId: string;
}
const LoadCommentsByUser = Request.tagged<LoadCommentsByUser>("LoadCommentsByUser");

interface LoadPostsByAuthor extends Request.Request<ReadonlyArray<Post>> {
  readonly _tag: "LoadPostsByAuthor";
  readonly userId: string;
}
const LoadPostsByAuthor = Request.tagged<LoadPostsByAuthor>("LoadPostsByAuthor");

// Resolver services. Each holds one RequestResolver, provisioned per request.
class UserResolver extends Context.Service<
  UserResolver,
  RequestResolver.RequestResolver<LoadUser>
>()("blog/UserResolver") {}

class CommentsByPostResolver extends Context.Service<
  CommentsByPostResolver,
  RequestResolver.RequestResolver<LoadCommentsByPost>
>()("blog/CommentsByPostResolver") {}

class CommentsByUserResolver extends Context.Service<
  CommentsByUserResolver,
  RequestResolver.RequestResolver<LoadCommentsByUser>
>()("blog/CommentsByUserResolver") {}

class PostsByAuthorResolver extends Context.Service<
  PostsByAuthorResolver,
  RequestResolver.RequestResolver<LoadPostsByAuthor>
>()("blog/PostsByAuthorResolver") {}

const RequestLayer = Layer.mergeAll(
  Layer.effect(Auth)(
    Effect.map(ProviderRequest, (req) => {
      const userId = req.headers["x-user"];
      return { userId: typeof userId === "string" && userId !== "" ? userId : null };
    }),
  ),
  Layer.succeed(UserResolver)(
    RequestResolver.fromFunctionBatched<LoadUser>((entries) =>
      entries.map((e) => USERS.find((u) => u.id === e.request.id) ?? null),
    ),
  ),
  Layer.succeed(CommentsByPostResolver)(
    RequestResolver.fromFunctionBatched<LoadCommentsByPost>((entries) =>
      entries.map((e) => COMMENTS.filter((c) => c.postId === e.request.postId)),
    ),
  ),
  Layer.succeed(CommentsByUserResolver)(
    RequestResolver.fromFunctionBatched<LoadCommentsByUser>((entries) =>
      entries.map((e) => COMMENTS.filter((c) => c.authorId === e.request.userId)),
    ),
  ),
  Layer.succeed(PostsByAuthorResolver)(
    RequestResolver.fromFunctionBatched<LoadPostsByAuthor>((entries) =>
      entries.map((e) => POSTS.filter((p) => p.authorId === e.request.userId)),
    ),
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────────────────────────────────────

const requireAuth = Effect.gen(function*() {
  const auth = yield* Auth;
  if (auth.userId === null) {
    yield* Effect.fail(new Forbidden({ _tag: "Forbidden", reason: "x-user header required" }));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers to keep resolver bodies readable
// ─────────────────────────────────────────────────────────────────────────────

const loadUser = (id: string) =>
  Effect.flatMap(UserResolver, (r) => Effect.request(LoadUser({ id }), r));

const loadCommentsByPost = (postId: string) =>
  Effect.flatMap(CommentsByPostResolver, (r) =>
    Effect.request(LoadCommentsByPost({ postId }), r),
  );

const loadCommentsByUser = (userId: string) =>
  Effect.flatMap(CommentsByUserResolver, (r) =>
    Effect.request(LoadCommentsByUser({ userId }), r),
  );

const loadPostsByAuthor = (userId: string) =>
  Effect.flatMap(PostsByAuthorResolver, (r) =>
    Effect.request(LoadPostsByAuthor({ userId }), r),
  );

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export const provider = Provider.make({
  app: Layer.empty,
  request: RequestLayer,

  query: {
    // me — auth-required; returns the authenticated user
    me: Provider.field({
      rpc: Rpc.make("me", { success: User, error: Forbidden }),
      guards: [requireAuth],
      resolve: () =>
        Effect.gen(function*() {
          const auth = yield* Auth;
          const userId = auth.userId!;
          const user = yield* loadUser(userId);
          if (!user) {
            return yield* Effect.fail(
              new Forbidden({ _tag: "Forbidden", reason: `unknown user ${userId}` }),
            );
          }
          return user;
        }),
    }),

    // user(id) — public lookup by id
    user: Provider.field({
      rpc: Rpc.make("user", {
        payload: { id: Schema.String },
        success: User,
        error: NotFound,
      }),
      resolve: ({ id }) =>
        Effect.gen(function*() {
          const user = yield* loadUser(id);
          if (!user) {
            return yield* Effect.fail(
              new NotFound({ _tag: "NotFound", message: `user ${id} not found` }),
            );
          }
          return user;
        }),
    }),

    users: Provider.field({
      rpc: Rpc.make("users", { success: Schema.Array(User) }),
      resolve: () => Effect.succeed([...USERS]),
    }),

    posts: Provider.field({
      rpc: Rpc.make("posts", { success: Schema.Array(Post) }),
      resolve: () => Effect.succeed([...POSTS]),
    }),

    postsByStatus: Provider.field({
      rpc: Rpc.make("postsByStatus", {
        payload: { status: PostStatus },
        success: Schema.Array(Post),
      }),
      resolve: ({ status }) => Effect.succeed(POSTS.filter((p) => p.status === status)),
    }),

    post: Provider.field({
      rpc: Rpc.make("post", {
        payload: { id: Schema.String },
        success: Post,
        error: NotFound,
      }),
      resolve: ({ id }) => {
        const post = POSTS.find((p) => p.id === id);
        return post
          ? Effect.succeed(post)
          : Effect.fail(new NotFound({ _tag: "NotFound", message: `post ${id} not found` }));
      },
    }),
  },

  mutation: {
    createPost: Provider.field({
      rpc: Rpc.make("createPost", {
        payload: { input: CreatePostInput },
        success: Post,
        error: Forbidden,
      }),
      guards: [requireAuth],
      resolve: ({ input }) =>
        Effect.gen(function*() {
          const auth = yield* Auth;
          const userId = auth.userId!;
          return storeCreatePost({
            title: input.title,
            body: input.body,
            status: input.status,
            authorId: userId,
          });
        }),
    }),
  },

  augmentations: [
    Provider.augment(
      Post,
      Rpc.make("author", { success: User, error: NotFound }),
      (post) =>
        Effect.gen(function*() {
          const author = yield* loadUser(post.authorId);
          return author ?? (yield* Effect.fail(
            new NotFound({ _tag: "NotFound", message: `author ${post.authorId} not found` }),
          ));
        }),
    ),

    Provider.augment(
      Post,
      Rpc.make("comments", { success: Schema.Array(Comment) }),
      (post) => loadCommentsByPost(post.id),
    ),

    Provider.augment(
      User,
      Rpc.make("posts", { success: Schema.Array(Post) }),
      (user) => loadPostsByAuthor(user.id),
    ),

    Provider.augment(
      User,
      Rpc.make("comments", { success: Schema.Array(Comment) }),
      (user) => loadCommentsByUser(user.id),
    ),

    Provider.augment(
      Comment,
      Rpc.make("author", { success: User, error: NotFound }),
      (comment) =>
        Effect.gen(function*() {
          const author = yield* loadUser(comment.authorId);
          return author ?? (yield* Effect.fail(
            new NotFound({ _tag: "NotFound", message: `author ${comment.authorId} not found` }),
          ));
        }),
    ),

    Provider.augment(
      Comment,
      Rpc.make("post", { success: Post, error: NotFound }),
      (comment) => {
        const post = POSTS.find((p) => p.id === comment.postId);
        return post
          ? Effect.succeed(post)
          : Effect.fail(new NotFound({ _tag: "NotFound", message: `post ${comment.postId} not found` }));
      },
    ),
  ],
});
