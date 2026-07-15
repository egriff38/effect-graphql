# Declare root operations

Add queries and mutations to a `Provider` with `Provider.field` and
`Rpc.make`.

## Prerequisites

- You've completed the [Quickstart](/quickstart).
- You have a `Schema.Class` for at least one type in your API.

## A query with no arguments

```ts twoslash
import { Effect, Layer, Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { Provider } from "effect-graphql"

class User extends Schema.Class<User>("User")({
  id: Schema.String.annotate({ graphql: { id: true } }),
  name: Schema.String,
}) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    me: Provider.field({
      rpc: Rpc.make("me", { success: User }),
      resolve: () => Effect.succeed(new User({ id: "u1", name: "Ada" })),
    }),
  },
})
```

`success: User` is the return type. `resolve` receives no argument object
because the RPC declared no `payload`.

## A query with arguments

Declare a `payload` on the `Rpc.make` call. `resolve` receives the decoded
payload as its first argument:

```ts twoslash
import { Effect, Layer, Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { Provider } from "effect-graphql"

class User extends Schema.Class<User>("User")({
  id: Schema.String.annotate({ graphql: { id: true } }),
  name: Schema.String,
}) {}

const USERS = [new User({ id: "u1", name: "Ada" })]

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    user: Provider.field({
      rpc: Rpc.make("user", {
        payload: { id: Schema.String },
        success: Schema.NullOr(User),
      }),
      resolve: ({ id }) => Effect.succeed(USERS.find((u) => u.id === id) ?? null),
    }),
  },
})
```

Hover `id` in `resolve` — it's inferred as `string` from the payload schema.

## A mutation

Same shape as a query; move the field under `mutation:` instead of `query:`.
The RPC and resolver look identical.

```ts twoslash
import { Effect, Layer, Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { Provider } from "effect-graphql"

class Post extends Schema.Class<Post>("Post")({
  id: Schema.String.annotate({ graphql: { id: true } }),
  title: Schema.String,
}) {}

class CreatePostInput extends Schema.Class<CreatePostInput>("CreatePostInput")({
  title: Schema.String,
}) {}

let nextId = 1

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    posts: Provider.field({
      rpc: Rpc.make("posts", { success: Schema.Array(Post) }),
      resolve: () => Effect.succeed<Post[]>([]),
    }),
  },
  mutation: {
    createPost: Provider.field({
      rpc: Rpc.make("createPost", {
        payload: { input: CreatePostInput },
        success: Post,
      }),
      resolve: ({ input }) =>
        Effect.succeed(new Post({ id: `p${nextId++}`, title: input.title })),
    }),
  },
})
```

The generated SDL contains both a `Query` type and a `Mutation` type.
Introspection is on by default in development; see [Serving over
HTTP](/serving) for how to gate it in production.

## Multiple root fields

Fields are keys on the `query` or `mutation` object. Order doesn't matter —
graphql-js resolves them in the order the client asks for them.

```ts twoslash
import { Effect, Layer, Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { Provider } from "effect-graphql"

class User extends Schema.Class<User>("User")({
  id: Schema.String.annotate({ graphql: { id: true } }),
  name: Schema.String,
}) {}

const USERS = [new User({ id: "u1", name: "Ada" })]

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    me: Provider.field({
      rpc: Rpc.make("me", { success: User }),
      resolve: () => Effect.succeed(USERS[0]!),
    }),
    users: Provider.field({
      rpc: Rpc.make("users", { success: Schema.Array(User) }),
      resolve: () => Effect.succeed(USERS),
    }),
    user: Provider.field({
      rpc: Rpc.make("user", {
        payload: { id: Schema.String },
        success: Schema.NullOr(User),
      }),
      resolve: ({ id }) => Effect.succeed(USERS.find((u) => u.id === id) ?? null),
    }),
  },
})
```

## Verify

Print the SDL to check the shape:

```ts twoslash
import { Effect, Layer, Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { Provider } from "effect-graphql"
import { printSchema } from "graphql"

class User extends Schema.Class<User>("User")({
  id: Schema.String.annotate({ graphql: { id: true } }),
  name: Schema.String,
}) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    me: Provider.field({
      rpc: Rpc.make("me", { success: User }),
      resolve: () => Effect.succeed(new User({ id: "u1", name: "Ada" })),
    }),
  },
})

const sdl = printSchema(Provider.toSchema(provider))
```

Or run one:

```ts twoslash
import { Effect, Layer, Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { Provider, Executor } from "effect-graphql"

class User extends Schema.Class<User>("User")({
  id: Schema.String.annotate({ graphql: { id: true } }),
  name: Schema.String,
}) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    me: Provider.field({
      rpc: Rpc.make("me", { success: User }),
      resolve: () => Effect.succeed(new User({ id: "u1", name: "Ada" })),
    }),
  },
})

const executor = Executor.make(provider)
const result = await executor.execute({
  query: `{ me { id name } }`,
  request: { method: "POST", url: "/graphql", headers: {}, body: null },
})
```

`result.data.me` is `{ id: "u1", name: "Ada" }`.

## Related

- [Types and augmentations](/types-vs-augmentations) — attach fields
  to types you've already declared.
- [Errors as data](/errors-as-data) — declare typed errors on an RPC
  and read them from the derived result union.
