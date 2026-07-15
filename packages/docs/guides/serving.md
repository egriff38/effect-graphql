# How to serve a `Provider` over HTTP

Mount `Provider.serve(provider)` under `/graphql` and GraphiQL under
`/graphiql` via effect-platform's `HttpRouter`, turning off introspection
outside development.

## Prerequisites

- A `Provider` — see [Declare root operations](/guides/root-operations) if you
  haven't built one yet.
- `@effect/platform-bun` installed (`bun add @effect/platform-bun`). The
  `@effect/platform-node` package binds the same router the same way.

## Steps

1. **Wire the router.** Add one `POST /graphql` route calling
   `Provider.serve` and one `GET /graphiql` route rendering the IDE page.
   Provide the resulting layer to `BunHttpServer.layer` and hand the launched
   layer to `BunRuntime.runMain`.

   ```ts twoslash
   import { Effect, Layer, Schema } from "effect"
   import { HttpRouter } from "effect/unstable/http"
   import { Rpc } from "effect/unstable/rpc"
   import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
   import { Provider } from "effect-graphql"
   import { graphiql } from "effect-graphql/graphiql"

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

   const Routes = Layer.mergeAll(
     HttpRouter.add("POST", "/graphql", Provider.serve(provider)),
     HttpRouter.add("GET", "/graphiql", graphiql({ endpoint: "/graphql" })),
   )

   const Server = HttpRouter.serve(Routes).pipe(
     Layer.provide(BunHttpServer.layer({ port: 3000 })),
   )

   BunRuntime.runMain(Layer.launch(Server))
   ```

   `Provider.serve` returns an `HttpApp` — an `Effect` that reads the
   `HttpServerRequest`, executes the operation through the Provider's
   two-tier runtime, and returns an `HttpServerResponse`. The router
   dispatches to it by method and path.

2. **Pick a platform binding.** Swap `BunHttpServer.layer` /
   `BunRuntime.runMain` for `NodeHttpServer.layer(createServer, { port })` /
   `NodeRuntime.runMain` from `@effect/platform-node`; the router and the
   `Provider.serve` call stay identical.

3. **Harden the endpoint in production.** Pass a second argument to
   `Provider.serve` to turn off introspection and cap query depth. Toggle
   by environment so GraphiQL's schema explorer keeps working locally.

   ```ts twoslash
   import { Effect, Layer, Schema } from "effect"
   import { HttpRouter } from "effect/unstable/http"
   import { Rpc } from "effect/unstable/rpc"
   import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
   import { Provider } from "effect-graphql"
   import { graphiql } from "effect-graphql/graphiql"

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

   const isProd = process.env["NODE_ENV"] === "production"

   const Routes = Layer.mergeAll(
     HttpRouter.add(
       "POST",
       "/graphql",
       Provider.serve(provider, isProd ? { introspection: false, maxDepth: 10 } : {}),
     ),
     HttpRouter.add(
       "GET",
       "/graphiql",
       graphiql({ endpoint: "/graphql", defaultHeaders: { "x-user": "u1" } }),
     ),
   )

   const Server = HttpRouter.serve(Routes).pipe(
     Layer.provide(BunHttpServer.layer({ port: 3000 })),
   )

   BunRuntime.runMain(Layer.launch(Server))
   ```

   `defaultHeaders` pre-seeds GraphiQL's Headers panel so local requests
   arrive with the fields your `RequestLayer` expects. Users can still edit
   them in the page.

## Verify

Send a query and read the JSON response:

```sh
curl -s http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ me { id name } }"}'
# {"data":{"me":{"id":"u1","name":"Ada"}}}
```

With `NODE_ENV=production`, the schema rejects introspection at parse time:

```sh
NODE_ENV=production bun run server.ts &
curl -s http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ __schema { types { name } } }"}'
# {"errors":[{"message":"GraphQL introspection is not allowed, but the query contained __schema."}]}
```

## Related

- [Errors as data](/guides/errors-as-data) — typed error union members surface
  through this endpoint the same way they surface through `Executor.execute`.
- [Yoga, Apollo, Mercurius adapters](/guides/adapters) — skip `Provider.serve`
  and hand `Provider.toSchema(provider)` to a different HTTP server.
- [Declare root operations](/guides/root-operations) — the shape of the
  `provider` this recipe mounts.
