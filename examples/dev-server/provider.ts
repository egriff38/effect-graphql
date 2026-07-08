/**
 * The Provider for the dev server. Wires:
 *
 *  - app layer: empty (no app-scoped services here; in production this is where
 *    DB pools and config Layers go)
 *  - request layer: Auth (from x-user header) + per-request loaders that
 *    coalesce N+1 augmentation lookups into one batch
 *  - root operations (queries + mutation)
 *  - augmentations on User, Post, and Comment forming a cyclic capability graph
 *    (User.posts → Post.author → User, Post.comments → Comment.post → Post, …)
 */

import { Context, Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { Loader, Provider, ProviderRequest } from "../../packages/core/src/index.ts";
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

/** Load users by id, batched per tick. Used by Post.author and Comment.author. */
class UserByIdLoader extends Context.Service<UserByIdLoader, Loader.Loader<string, User | null>>()(
  "blog/UserByIdLoader",
) {}

/** Load all comments for a post id, batched. Used by Post.comments. */
class CommentsByPostLoader extends Context.Service<
  CommentsByPostLoader,
  Loader.Loader<string, ReadonlyArray<Comment>>
>()("blog/CommentsByPostLoader") {}

/** Load all comments authored by a user id, batched. Used by User.comments. */
class CommentsByUserLoader extends Context.Service<
  CommentsByUserLoader,
  Loader.Loader<string, ReadonlyArray<Comment>>
>()("blog/CommentsByUserLoader") {}

/** Load all posts authored by a user id, batched. Used by User.posts. */
class PostsByAuthorLoader extends Context.Service<
  PostsByAuthorLoader,
  Loader.Loader<string, ReadonlyArray<Post>>
>()("blog/PostsByAuthorLoader") {}

const RequestLayer = Layer.mergeAll(
  Layer.effect(Auth)(
    Effect.map(ProviderRequest, (req) => {
      const userId = req.headers["x-user"];
      return { userId: typeof userId === "string" && userId !== "" ? userId : null };
    }),
  ),
  Layer.effect(UserByIdLoader)(
    Loader.make((ids: ReadonlyArray<string>) =>
      Effect.sync(() => ids.map((id) => USERS.find((u) => u.id === id) ?? null))
    ),
  ),
  Layer.effect(CommentsByPostLoader)(
    Loader.make((postIds: ReadonlyArray<string>) =>
      Effect.sync(() => postIds.map((id) => COMMENTS.filter((c) => c.postId === id)))
    ),
  ),
  Layer.effect(CommentsByUserLoader)(
    Loader.make((userIds: ReadonlyArray<string>) =>
      Effect.sync(() => userIds.map((id) => COMMENTS.filter((c) => c.authorId === id)))
    ),
  ),
  Layer.effect(PostsByAuthorLoader)(
    Loader.make((userIds: ReadonlyArray<string>) =>
      Effect.sync(() => userIds.map((id) => POSTS.filter((p) => p.authorId === id)))
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
          // requireAuth guarantees userId !== null at this point
          const userId = auth.userId!;
          const loader = yield* UserByIdLoader;
          const user = yield* loader.load(userId);
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
          const loader = yield* UserByIdLoader;
          const user = yield* loader.load(id);
          if (!user) {
            return yield* Effect.fail(
              new NotFound({ _tag: "NotFound", message: `user ${id} not found` }),
            );
          }
          return user;
        }),
    }),

    // users — full list
    users: Provider.field({
      rpc: Rpc.make("users", { success: Schema.Array(User) }),
      resolve: () => Effect.succeed([...USERS]),
    }),

    // posts — all posts
    posts: Provider.field({
      rpc: Rpc.make("posts", { success: Schema.Array(Post) }),
      resolve: () => Effect.succeed([...POSTS]),
    }),

    // postsByStatus(status) — required enum filter (demonstrates enum in input position)
    postsByStatus: Provider.field({
      rpc: Rpc.make("postsByStatus", {
        payload: { status: PostStatus },
        success: Schema.Array(Post),
      }),
      resolve: ({ status }) => Effect.succeed(POSTS.filter((p) => p.status === status)),
    }),

    // post(id) — single post lookup
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
    // createPost(input) — auth-gated; structured input gets schema-validated
    // before the resolver runs (NonEmptyString rejects empty title at the wire)
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
    // Post.author — typed-error result (post may reference deleted user)
    Provider.augment(
      Post,
      Rpc.make("author", { success: User, error: NotFound }),
      (post) =>
        Effect.gen(function*() {
          const loader = yield* UserByIdLoader;
          const author = yield* loader.load(post.authorId);
          return author ?? (yield* Effect.fail(
            new NotFound({ _tag: "NotFound", message: `author ${post.authorId} not found` }),
          ));
        }),
    ),

    // Post.comments — list of comments on the post (batched)
    Provider.augment(
      Post,
      Rpc.make("comments", { success: Schema.Array(Comment) }),
      (post) =>
        Effect.gen(function*() {
          const loader = yield* CommentsByPostLoader;
          return yield* loader.load(post.id);
        }),
    ),

    // User.posts — list of posts authored by this user (batched)
    Provider.augment(
      User,
      Rpc.make("posts", { success: Schema.Array(Post) }),
      (user) =>
        Effect.gen(function*() {
          const loader = yield* PostsByAuthorLoader;
          return yield* loader.load(user.id);
        }),
    ),

    // User.comments — list of comments by this user (batched)
    Provider.augment(
      User,
      Rpc.make("comments", { success: Schema.Array(Comment) }),
      (user) =>
        Effect.gen(function*() {
          const loader = yield* CommentsByUserLoader;
          return yield* loader.load(user.id);
        }),
    ),

    // Comment.author — typed-error result (comment may reference deleted user)
    Provider.augment(
      Comment,
      Rpc.make("author", { success: User, error: NotFound }),
      (comment) =>
        Effect.gen(function*() {
          const loader = yield* UserByIdLoader;
          const author = yield* loader.load(comment.authorId);
          return author ?? (yield* Effect.fail(
            new NotFound({ _tag: "NotFound", message: `author ${comment.authorId} not found` }),
          ));
        }),
    ),

    // Comment.post — typed-error result; not batched (lookup is by primary key)
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
