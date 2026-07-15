# Authorize a field

Deny a resolver call from outside its authorized set, and surface the denial
as a typed error union member.

## Prerequisites

- You've completed the [Quickstart](/quickstart).
- You've read [Errors as data](/errors-as-data) — the denied case is
  a member of the field's derived result union.

## Steps

1. **Declare an auth service and provide it from `ProviderRequest`.**

   The `request` Layer runs once per request. Read whatever your transport
   carries (a bearer header, a signed cookie, a session token) and reify it
   as an Effect service the resolver body can pull from `Context`.

   ```ts twoslash
   import { Context, Effect, Layer } from "effect"
   import { ProviderRequest } from "effect-graphql"

   class Auth extends Context.Service<Auth, { readonly role: string }>()(
     "app/Auth",
   ) {}

   const AuthLayer = Layer.effect(Auth)(
     Effect.gen(function*() {
       const request = yield* ProviderRequest
       const role = request.headers["x-role"]
       return { role: typeof role === "string" ? role : "guest" }
     }),
   )
   ```

2. **Write the guard.** A guard is an `Effect<void, E, R>` — pull the auth
   service, `Effect.fail` a typed error when the caller isn't authorized.
   Nothing else.

   ```ts twoslash
   import { Context, Effect, Schema } from "effect"

   class Auth extends Context.Service<Auth, { readonly role: string }>()(
     "app/Auth",
   ) {}

   class Forbidden extends Schema.Class<Forbidden>("Forbidden")({
     _tag: Schema.Literal("Forbidden"),
     reason: Schema.String,
   }) {}

   const adminOnly = Effect.gen(function*() {
     const auth = yield* Auth
     if (auth.role !== "admin") {
       yield* Effect.fail(
         new Forbidden({ _tag: "Forbidden", reason: "admin only" }),
       )
     }
   })
   ```

3. **Attach the guard to a field.** Pass it in the `guards` array on
   `Provider.field`. Declare the same error type in the field's `Rpc.make`
   `error` schema so it lands in the derived result union.

   ```ts twoslash
   import { Context, Effect, Layer, Schema } from "effect"
   import { Rpc } from "effect/unstable/rpc"
   import { Provider, ProviderRequest } from "effect-graphql"

   class Secret extends Schema.Class<Secret>("Secret")({
     value: Schema.String,
   }) {}

   class Forbidden extends Schema.Class<Forbidden>("Forbidden")({
     _tag: Schema.Literal("Forbidden"),
     reason: Schema.String,
   }) {}

   class Auth extends Context.Service<Auth, { readonly role: string }>()(
     "app/Auth",
   ) {}

   const adminOnly = Effect.gen(function*() {
     const auth = yield* Auth
     if (auth.role !== "admin") {
       yield* Effect.fail(
         new Forbidden({ _tag: "Forbidden", reason: "admin only" }),
       )
     }
   })

   const provider = Provider.make({
     app: Layer.empty,
     request: Layer.effect(Auth)(
       Effect.gen(function*() {
         const request = yield* ProviderRequest
         const role = request.headers["x-role"]
         return { role: typeof role === "string" ? role : "guest" }
       }),
     ),
     query: {
       secret: Provider.field({
         rpc: Rpc.make("secret", { success: Secret, error: Forbidden }),
         guards: [adminOnly],
         resolve: () => Effect.succeed(new Secret({ value: "42" })),
       }),
     },
   })
   ```

4. **Compose multiple guards.** The `guards` array is ordered; each runs
   before the next. The first failure short-circuits with its typed error.

   ```ts twoslash
   import { Context, Effect, Schema } from "effect"

   class Auth extends Context.Service<Auth, { readonly role: string }>()(
     "app/Auth",
   ) {}

   class Forbidden extends Schema.Class<Forbidden>("Forbidden")({
     _tag: Schema.Literal("Forbidden"),
     reason: Schema.String,
   }) {}

   const requireAuthenticated = Effect.gen(function*() {
     const auth = yield* Auth
     if (auth.role === "guest") {
       yield* Effect.fail(
         new Forbidden({ _tag: "Forbidden", reason: "sign in required" }),
       )
     }
   })

   const requireAdmin = Effect.gen(function*() {
     const auth = yield* Auth
     if (auth.role !== "admin") {
       yield* Effect.fail(
         new Forbidden({ _tag: "Forbidden", reason: "admin only" }),
       )
     }
   })

   const guards = [requireAuthenticated, requireAdmin]
   ```

## Verify

Query the field twice — once as an admin, once as a guest — with inline
fragments over the result union.

```ts twoslash
import { Context, Effect, Layer, Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { Executor, Provider, ProviderRequest } from "effect-graphql"

class Secret extends Schema.Class<Secret>("Secret")({
  value: Schema.String,
}) {}

class Forbidden extends Schema.Class<Forbidden>("Forbidden")({
  _tag: Schema.Literal("Forbidden"),
  reason: Schema.String,
}) {}

class Auth extends Context.Service<Auth, { readonly role: string }>()(
  "app/Auth",
) {}

const adminOnly = Effect.gen(function*() {
  const auth = yield* Auth
  if (auth.role !== "admin") {
    yield* Effect.fail(
      new Forbidden({ _tag: "Forbidden", reason: "admin only" }),
    )
  }
})

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.effect(Auth)(
    Effect.gen(function*() {
      const request = yield* ProviderRequest
      const role = request.headers["x-role"]
      return { role: typeof role === "string" ? role : "guest" }
    }),
  ),
  query: {
    secret: Provider.field({
      rpc: Rpc.make("secret", { success: Secret, error: Forbidden }),
      guards: [adminOnly],
      resolve: () => Effect.succeed(new Secret({ value: "42" })),
    }),
  },
})

const executor = Executor.make(provider)
const query = `{ secret { __typename ... on Secret { value } ... on Forbidden { reason } } }`

const asAdmin = await executor.execute({
  query,
  request: { method: "POST", url: "/graphql", headers: { "x-role": "admin" }, body: null },
})

const asGuest = await executor.execute({
  query,
  request: { method: "POST", url: "/graphql", headers: { "x-role": "guest" }, body: null },
})
```

`asAdmin.data` is `{ secret: { __typename: "Secret", value: "42" } }`.
`asGuest.data` is `{ secret: { __typename: "Forbidden", reason: "admin only" } }`.
Neither response uses top-level `errors[]` — the denial is business data,
not a transport failure.

## Related

- [Errors as data](/errors-as-data) — the shape of the derived result
  union.
- [Root operations](/root-operations) — where `guards` sits on
  `Provider.field`.
- [Serving over HTTP](/serving) — how request headers reach
  `ProviderRequest`.
