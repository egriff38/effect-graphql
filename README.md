# effect-graphql

Derive a GraphQL API from Effect `Schema` types and Effect-based resolvers. Effect owns
the runtime; graphql-js owns the wire.

## Status

**0.x — the surface is stable enough to try, but expect minor breakage until 1.0.**

Full documentation is tracked in [#15](https://github.com/egriff38/effect-graphql/issues/15).
Remaining GraphQL spec features are catalogued and complexity-rated in
[#23](https://github.com/egriff38/effect-graphql/issues/23).

## Install

```sh
bun add effect-graphql effect graphql
# or npm / pnpm / yarn — effect and graphql are peer dependencies
```

```ts
import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { Provider } from "effect-graphql";

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
});

// `toExecutor` wraps `graphql-js` with the two-tier runtime: `app` services
// live for the process, `request` services (auth, loaders, per-request state)
// are rebuilt from `request` fields on every call.
const executor = Provider.toExecutor(provider);

const result = await executor.execute({
  query: `{ me { id name } }`,
  request: { method: "POST", url: "/graphql", headers: {}, body: null },
});
console.log(result); // { data: { me: { id: "u1", name: "Ada" } } }
```

`Provider.toSchema(provider)` is also available — it returns the raw
`GraphQLSchema` for tooling (SDL printing, Yoga/Apollo integration) — but you
**can't `graphql()` it directly**; the resolvers depend on the runtime that
`toExecutor` supplies via `contextValue`.

## What it does

- Derives a `GraphQLSchema` from `Schema.Class` / `Schema.TaggedClass` shapes.
- Runs resolvers as `Effect<A, E, R>` inside a two-tier runtime (app-scoped services + a
  per-request context Layer built from headers/method/URL/body).
- Types errors-as-data via result unions (ADR-0002).
- Batches loads inside a request via `createLoader` (ADR-0003).
- Ships a `Provider.serve` HttpApp and a tree-shakable `graphiql` subpath.

## Ideas & roadmap

- Wishlist (spec features, rated 1–10 complexity): [#23](https://github.com/egriff38/effect-graphql/issues/23)
- Design decisions live in [`docs/adr/`](./docs/adr/)
- Domain vocabulary lives in [`CONTEXT.md`](./CONTEXT.md)

## License

MIT © Eshin Griffith
