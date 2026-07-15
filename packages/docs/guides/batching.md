# Batch resolver calls with `Provider.batch`

Coalesce N sibling resolvers that hit the same data source into one call by
wiring a `Provider.batch` loader and invoking it from each resolver body.

## Prerequisites

- You can [declare root operations](/guides/root-operations) with
  `Provider.field` and `Rpc.make`.
- Your query fans out — one root field returns a list, each item's
  augmentation looks up a related record by id.

## Steps

### 1. Declare the loader

`Provider.batch` takes a tag and a `runAll` function. `runAll` receives every
same-tick payload in one array and MUST return the successes in the same
order. Type parameters flow from the arguments.

```ts twoslash
import { Provider } from "effect-graphql"

interface User {
  readonly id: string
  readonly name: string
}

const USERS: ReadonlyArray<User> = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Linus" },
]

const loadUser = Provider.batch(
  "LoadUser",
  (payloads: ReadonlyArray<{ id: string }>) =>
    payloads.map((p) => USERS.find((u) => u.id === p.id) ?? null),
)
```

Hover `loadUser` — it's a callable `Effect` with `.tag` and `.resolver`
attached. `payloads` is `ReadonlyArray<{ id: string }>`; the return element
type infers as `User | null`.

### 2. Call the loader from an augmentation

The loader is a plain `Effect`. Return it from any resolver body. `Post` has
an `authorId`; the `Post.author` augmentation looks the user up. When a
query selects `posts { author { name } }`, every sibling `Post` fires
`loadUser` in the same tick and Effect's request scheduler collapses them
into one `runAll` invocation.

```ts twoslash
import { Effect, Layer, Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { Provider } from "effect-graphql"

class User extends Schema.Class<User>("User")({
  id: Schema.String.annotate({ graphql: { id: true } }),
  name: Schema.String,
}) {}

class Post extends Schema.Class<Post>("Post")({
  id: Schema.String.annotate({ graphql: { id: true } }),
  title: Schema.String,
  authorId: Schema.String,
}) {}

const USERS: ReadonlyArray<User> = [
  new User({ id: "u1", name: "Ada" }),
  new User({ id: "u2", name: "Linus" }),
]

const POSTS: ReadonlyArray<Post> = [
  new Post({ id: "p1", title: "Effect in prod", authorId: "u1" }),
  new Post({ id: "p2", title: "Typesafe APIs", authorId: "u1" }),
  new Post({ id: "p3", title: "Zero-cost schemas", authorId: "u2" }),
]

const loadUser = Provider.batch(
  "LoadUser",
  (payloads: ReadonlyArray<{ id: string }>) =>
    payloads.map((p) => USERS.find((u) => u.id === p.id) ?? null),
)

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    posts: Provider.field({
      rpc: Rpc.make("posts", { success: Schema.Array(Post) }),
      resolve: () => Effect.succeed(POSTS),
    }),
  },
  augmentations: [
    Provider.augment(
      Post,
      Rpc.make("author", { success: Schema.NullOr(User) }),
      (self) => loadUser({ id: self.authorId }),
    ),
  ],
})
```

Three posts fan out into three `loadUser` calls. `runAll` fires once with
`[{id:"u1"},{id:"u1"},{id:"u2"}]`.

### 3. Alternate form: Derive from an `Rpc`

Pass an existing `Rpc.make(...)` in place of the tag and Twoslash infers
payload and success from its schemas — no annotation on the callback.

```ts twoslash
import { Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { Provider } from "effect-graphql"

class User extends Schema.Class<User>("User")({
  id: Schema.String.annotate({ graphql: { id: true } }),
  name: Schema.String,
}) {}

const USERS: ReadonlyArray<User> = [new User({ id: "u1", name: "Ada" })]

const LoadUserRpc = Rpc.make("LoadUser", {
  payload: { id: Schema.String },
  success: User,
})

const loadUser = Provider.batch(LoadUserRpc, (payloads) =>
  payloads.map((p) => USERS.find((u) => u.id === p.id)!),
)
```

Same shape as Step 1, minus the inline type on `payloads`. Reach for this
when you also publish the loader as a first-class RPC endpoint on the
Provider — one schema, two call sites.

### 4. Reach for resolver combinators

`.tag` and `.resolver` are public so you can pipe the underlying request
resolver through Effect's combinators. `RequestResolver.withCache` builds a
bounded in-memory cache and returns an `Effect` producing the wrapped
resolver:

```ts twoslash
import { Effect, RequestResolver } from "effect"
import { Provider } from "effect-graphql"

interface User {
  readonly id: string
  readonly name: string
}
const USERS: ReadonlyArray<User> = []

const loadUser = Provider.batch(
  "LoadUser",
  (payloads: ReadonlyArray<{ id: string }>) =>
    payloads.map((p) => USERS.find((u) => u.id === p.id) ?? null),
)

const cachedLoadUser = Effect.gen(function* () {
  const cached = yield* RequestResolver.withCache(loadUser.resolver, {
    capacity: 256,
    strategy: "lru",
  })
  return (id: string) => Effect.request(loadUser.tag({ id }), cached)
})
```

The same pattern applies to `RequestResolver.setDelay`,
`RequestResolver.batchN`, `RequestResolver.withSpan`, and
`RequestResolver.persisted` — wrap `loader.resolver`, then feed the wrapped
resolver into `Effect.request(loader.tag(payload), wrapped)`.

## Verify

Assert one `runAll` batch fires for N sibling augmentations. This mirrors
`packages/core/test/loader.test.ts`.

```ts twoslash
import { Effect, Layer, Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { Executor, Provider } from "effect-graphql"

class Item extends Schema.Class<Item>("Item")({
  id: Schema.String.annotate({ graphql: { id: true } }),
}) {}

const batchCalls: Array<ReadonlyArray<string>> = []

const loadLabel = Provider.batch(
  "LoadLabel",
  (payloads: ReadonlyArray<{ id: string }>) => {
    const ids = payloads.map((p) => p.id)
    batchCalls.push(ids)
    return ids.map((k) => `label:${k}`)
  },
)

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    items: Provider.field({
      rpc: Rpc.make("items", { success: Schema.Array(Item) }),
      resolve: () =>
        Effect.succeed([
          new Item({ id: "a" }),
          new Item({ id: "b" }),
          new Item({ id: "c" }),
        ]),
    }),
  },
  augmentations: [
    Provider.augment(
      Item,
      Rpc.make("label", { success: Schema.String }),
      (self) => loadLabel({ id: self.id }),
    ),
  ],
})

const executor = Executor.make(provider)
const result = await executor.execute({
  query: `{ items { id label } }`,
  request: { method: "POST", url: "/graphql", headers: {}, body: null },
})
await executor.dispose()

// One batch fired with all three ids.
const oneBatch = batchCalls.length === 1
const allIds = batchCalls[0]?.join(",") === "a,b,c"
```

`oneBatch` is `true`; `allIds` is `true`; `result.data.items` has three
entries with `label: "label:<id>"`.

## Related

- [Declare root operations](/guides/root-operations) — the field shape the
  augmentations extend.
- [Types and augmentations](/guides/types-vs-augmentations) — where
  `Provider.augment` fits alongside `Schema.Class` types.
- [ADR 0003 — request-scoped tick-batched loaders](https://github.com/egriff38/effect-graphql/blob/master/packages/core/docs/adr/0003-request-scoped-tick-batched-loaders.md)
  — why the loader lives on `Provider` instead of a per-request layer.
