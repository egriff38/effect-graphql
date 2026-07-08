# Quickstart

Declare one query. Run it. Confirm the shape.

## Install

```sh
bun add effect-graphql effect graphql
```

`effect` and `graphql` are peer dependencies. Any version of Effect from
`4.0.0-beta.74` and any 16.x of `graphql` work.

## Declare a `Provider`

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
```

Hover any token to see its inferred TypeScript type in the rendered page.

## Run a query

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

## Next

- The [API reference](https://effect-graphql.js.org) has every export with a
  typechecked example.
- More guides land as [#28](https://github.com/egriff38/effect-graphql/issues/28)
  closes out.
