# Why Effect for GraphQL

`effect-graphql` derives a GraphQL schema from Effect `Schema` and runs
resolvers as `Effect`s — winning where the caller wants typed errors,
request-scoped services, cross-resolver batching, and Effect's tracing and
DI, and losing where the caller wants ecosystem breadth or a builder-first
API.

## Shape

The same operation — `user(id: ID!): User` — declared three ways. Only the
`effect-graphql` sample is Twoslash-checked; the Pothos and Nexus snippets
depict shape and are not part of this repo's compile fence.

### Pothos

Builder DSL. Resolvers are plain functions; batching comes from a `context`
loader (via the `@pothos/plugin-dataloader` plugin). Errors thrown from a
resolver land in the GraphQL response's `errors[]` array.

```ts
import SchemaBuilder from "@pothos/core"
import type DataLoader from "dataloader"

type User = { id: string; name: string }

const builder = new SchemaBuilder<{
  Context: { userLoader: DataLoader<string, User> }
}>({})

builder.objectRef<User>("User").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
  }),
})

builder.queryType({
  fields: (t) => ({
    user: t.field({
      type: "User",
      args: { id: t.arg.string({ required: true }) },
      resolve: (_, { id }, ctx) => ctx.userLoader.load(id),
    }),
  }),
})
```

### Nexus

Code-first with `t.field({...})`. Same throw-based error path — a raised
exception in `resolve` becomes an entry in `errors[]`.

```ts
import { makeSchema, objectType, queryType, stringArg } from "nexus"

const User = objectType({
  name: "User",
  definition(t) {
    t.id("id")
    t.string("name")
  },
})

const Query = queryType({
  definition(t) {
    t.field("user", {
      type: "User",
      args: { id: stringArg({ required: true }) },
      resolve(_, { id }, ctx) {
        const user = ctx.users.find((u: User) => u.id === id)
        if (!user) throw new Error(`no user ${id}`)
        return user
      },
    })
  },
})

const schema = makeSchema({ types: [User, Query] })
```

### `effect-graphql`

`Provider.field` with an `Rpc.make` that carries a typed `error` schema.
`resolve` returns an `Effect`; `Effect.fail(new NotFound({ ... }))` produces
a union member in the derived schema instead of an `errors[]` entry.

```ts twoslash
import { Effect, Layer, Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { Provider } from "effect-graphql"

class User extends Schema.Class<User>("User")({
  id: Schema.String.annotate({ graphql: { id: true } }),
  name: Schema.String,
}) {}

class NotFound extends Schema.Class<NotFound>("NotFound")({
  _tag: Schema.Literal("NotFound"),
  message: Schema.String,
}) {}

const USERS = [new User({ id: "u1", name: "Ada" })]

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    user: Provider.field({
      rpc: Rpc.make("user", {
        payload: { id: Schema.String },
        success: User,
        error: NotFound,
      }),
      resolve: ({ id }) => {
        const found = USERS.find((u) => u.id === id)
        return found
          ? Effect.succeed(found)
          : Effect.fail(new NotFound({ _tag: "NotFound", message: `no user ${id}` }))
      },
    }),
  },
})
```

The derived SDL contains `union UserResult = User | NotFound` and
`user(id: String!): UserResult!`. Clients discriminate on `__typename`. See
[Errors as data](/errors-as-data) for how to read it.

## When to pick this library

- Your business logic is already Effect-shaped — services, layers,
  interruptibility, `Effect.fn` tracing spans. Resolvers stay in the same
  runtime as the rest of your code, so the request scope, fiber-local
  state, and tracing context are the same object.
- You want typed errors as GraphQL union members instead of an untyped
  `errors[]` array. The schema union and the resolver's `Effect.fail`
  channel share one `Rpc.make` declaration — see
  [Errors as data](/errors-as-data).
- You need request-scoped DI. A `request` layer runs once per operation,
  and every resolver `Effect` sees the services it provides.
- You need cross-resolver batching that respects the current request scope.
  `Provider.batch` collapses payloads inside a single request tick — see
  [Batching with `Provider.batch`](/batching).
- You're on `effect@4.0.0-beta.74` or later and any `graphql@16.x`.

## When to pick something else

- **Federation or subscriptions today.** Both sit outside v1.
  [ADR 0005](https://github.com/egriff38/effect-graphql/blob/master/packages/core/docs/adr/0005-subscriptions-deferred-from-v1.md)
  records why subscriptions ship later. Federation has no design ADR yet.
- **Plugin ecosystem breadth.** Pothos ships first-party plugins for
  dataloader, Relay, auth scopes, directives, and more. This library has
  no plugin surface; the
  [spec wishlist](https://github.com/egriff38/effect-graphql/issues/23)
  tracks what's under consideration.
- **SDL-first workflow.** This library derives the schema from Effect
  `Schema` types. A team that writes `.graphql` files first and generates
  bindings from them is better served by tools designed around SDL.
- **Builder-first ergonomics.** If chained `t.field()` calls read better
  to your team than `Provider.field` plus an `Rpc.make`, pick the tool
  that matches that preference.

## See also

- [Quickstart](/quickstart)
- [Batching with `Provider.batch`](/batching)
- [Errors as data](/errors-as-data)
- [Serving over any HTTP adapter](/adapters)
- [Spec wishlist — issue #23](https://github.com/egriff38/effect-graphql/issues/23)
