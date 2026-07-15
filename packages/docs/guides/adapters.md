# How to integrate with Yoga, Apollo, or Mercurius

Use `Provider.toSchema` for SDL and tooling; use `Executor.make(provider).execute`
as the execution surface when you're mounting the API inside an existing Yoga,
Apollo, or Mercurius server. The paved path is still
[`Provider.serve`](/guides/serving) — reach for adapters only when the reader
already runs one of those servers.

## Prerequisites

- A `Provider` you've built with [`Provider.make`](/guides/root-operations).
- Familiarity with the target adapter — this guide sketches the integration
  point, not the adapter itself.

## `Provider.toSchema` is for SDL — not for execution

`Provider.toSchema(provider)` returns a `GraphQLSchema`. The types come out
canonical, and `printSchema` reads them cleanly for codegen, schema stitching,
gateway registration, or contract tests.

The resolvers on that schema require a `contextValue` of type
`RequestContextValue<R>` — the two-tier runtime that `Executor.make`
installs on every request. Handing the same schema to `graphql()` from
`graphql-js` without that context throws at runtime. Treat the schema as
a description; treat the executor as the runtime.

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

const sdl: string = printSchema(Provider.toSchema(provider))
```

`sdl` is a canonical SDL string. Feed it to `graphql-codegen`, publish it to
Apollo Studio, or diff it against a golden file in CI.

## Steps

### 1. Emit SDL for tooling

The preceding snippet is the whole story. `printSchema(Provider.toSchema(provider))`
runs at build time or in a one-shot script — no runtime, no executor.

### 2. Yoga — bring your own executor

Yoga expects both a `GraphQLSchema` and a matching executor. The default
executor is graphql-js's `execute`, which fails against a schema whose
resolvers need `RequestContextValue`. Bypass it with an envelop plugin
that replaces `executeFn` with a thin adapter over `executor.execute`.

The library ships no `Provider.toYoga` helper — track
[issue #23](https://github.com/egriff38/effect-graphql/issues/23) if that
sounds useful.

```ts
// yoga.ts — external adapter code, not part of effect-graphql
import { createYoga, Plugin } from "graphql-yoga"
import { print } from "graphql"
import { Executor, Provider } from "effect-graphql"
import { provider } from "./provider.ts"

const executor = Executor.make(provider)
const schema = Provider.toSchema(provider)

const useEffectGraphqlExecutor = (): Plugin => ({
  onExecute({ setExecuteFn }) {
    setExecuteFn(async (args) => {
      const request = (args.contextValue as { request: Request }).request
      return executor.execute({
        query: print(args.document),
        variables: args.variableValues ?? undefined,
        operationName: args.operationName ?? undefined,
        request: {
          method: request.method,
          url: request.url,
          headers: Object.fromEntries(request.headers),
          body: null,
        },
      })
    })
  },
})

export const yoga = createYoga({
  schema,
  plugins: [useEffectGraphqlExecutor()],
})
```

Yoga's `onExecute` seam swaps the default
`executeFn` for one that forwards to `executor.execute`, so Yoga's HTTP
pipeline, GraphiQL, and plugin ecosystem stay intact while resolvers run
under the effect-graphql runtime.

### 3. Apollo Server — mount via `gateway`

Apollo Server v4 exposes a `gateway` option that supplies its own executor.
That's the same seam — `executor.execute` maps onto the gateway's
`executor` field.

```ts
// apollo.ts — external adapter code, not part of effect-graphql
import { ApolloServer } from "@apollo/server"
import { print } from "graphql"
import { Executor, Provider } from "effect-graphql"
import { provider } from "./provider.ts"

const executor = Executor.make(provider)
const schema = Provider.toSchema(provider)

export const server = new ApolloServer({
  gateway: {
    async load() {
      return { executor: async ({ request, document, operationName }) => {
        return executor.execute({
          query: print(document),
          variables: request.variables ?? undefined,
          operationName: operationName ?? undefined,
          request: {
            method: "POST",
            url: request.http?.url ?? "/graphql",
            headers: Object.fromEntries(request.http?.headers ?? []),
            body: null,
          },
        })
      } }
    },
    async stop() { await executor.dispose() },
    onSchemaLoadOrUpdate(callback) {
      callback({ apiSchema: schema, coreSupergraphSdl: "" })
      return () => {}
    },
  },
})
```

For federation, register the printed SDL as a subgraph and let the gateway
own composition — see the
[Apollo `gateway` docs](https://www.apollographql.com/docs/apollo-server/api/apollo-server#gateway).

### 4. Mercurius

Mercurius' `custom` executor hook mirrors the same seam — supply a
function that receives `(schema, document, context, variables)` and
returns an `ExecutionResult`. The adapter body is the same shape as the
Yoga plugin: call `Executor.execute` with the printed document and
the request fields. No first-party helper exists yet; watch
[the issue tracker](https://github.com/egriff38/effect-graphql/issues)
if you want to help design one.

## Recommendation

New project? Use [`Provider.serve`](/guides/serving). It's the paved path
and handles request Layer wiring, hardening, and the effect-platform
`HttpApp` shape without an intermediate adapter.

Already on Yoga, Apollo, or Mercurius? Mount `Executor.make(provider).execute`
at that server's executor seam. `Provider.toSchema` still gives you the
`GraphQLSchema` for SDL, introspection tooling, and federation registration.

## Verify

The SDL sample below runs to completion — no runtime, no executor, no HTTP.
Compare its output against your expectations or a golden SDL file.

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

const sdl: string = printSchema(Provider.toSchema(provider))
console.log(sdl.startsWith("type Query"))
```

## Related

- [Serving over HTTP](/guides/serving) — the paved path with `Provider.serve`.
- [Declare root operations](/guides/root-operations) — build the `Provider`
  that feeds `toSchema` and `Executor.make`.
- [Why Effect for GraphQL](/guides/why-effect) — the two-tier runtime that
  makes `contextValue` load-bearing.
