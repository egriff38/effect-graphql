# Test a `Provider`

Exercise a Provider from a Vitest test without booting an HTTP server, then
add SDL and HTTP-level checks as needed.

## Prerequisites

- You've completed the [Quickstart](/guides/quickstart).
- Vitest installed in your project.

## Steps

1. **Unit-shape: `Executor.make` runs a query in-process.** Build the
   Provider, wrap it with `Executor.make`, call `execute`. No network, no
   subprocess. `result.data` is graphql-js's shape.

   ```ts twoslash
   import { Effect, Layer, Schema } from "effect"
   import { Rpc } from "effect/unstable/rpc"
   import { Executor, Provider } from "effect-graphql"

   class User extends Schema.Class<User>("User")({
     id: Schema.String,
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

   `result.data` is `{ me: { id: "u1", name: "Ada" } }`. `result.errors` is
   `undefined` on success. In a Vitest `it` block, assert against both:

   ```ts twoslash
   import { describe, expect, it } from "vitest"
   import { Effect, Layer, Schema } from "effect"
   import { Rpc } from "effect/unstable/rpc"
   import { Executor, Provider } from "effect-graphql"

   class User extends Schema.Class<User>("User")({
     id: Schema.String,
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

   describe("me query", () => {
     it("returns the authed user shape", async () => {
       const result = await Executor.make(provider).execute({
         query: `{ me { id name } }`,
         request: { method: "POST", url: "/graphql", headers: {}, body: null },
       })
       expect(result.errors).toBeUndefined()
       expect(result.data).toEqual({ me: { id: "u1", name: "Ada" } })
     })
   })
   ```

2. **Vary the request per test.** The `request` argument is
   `ProviderRequest.Fields` — set `headers` to exercise auth and other
   request-Layer branches.

   ```ts twoslash
   import { describe, expect, it } from "vitest"
   import { Context, Effect, Layer, Schema } from "effect"
   import { Rpc } from "effect/unstable/rpc"
   import { Executor, Provider, ProviderRequest } from "effect-graphql"

   class Secret extends Schema.Class<Secret>("Secret")({ value: Schema.String }) {}

   class Forbidden extends Schema.Class<Forbidden>("Forbidden")({
     _tag: Schema.Literal("Forbidden"),
     reason: Schema.String,
   }) {}

   class Auth extends Context.Service<Auth, { readonly role: string }>()("app/Auth") {}

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

   const run = (role: string) =>
     Executor.make(provider).execute({
       query: `{ secret { __typename ... on Secret { value } ... on Forbidden { reason } } }`,
       request: { method: "POST", url: "/graphql", headers: { "x-role": role }, body: null },
     })

   describe("secret query", () => {
     it("returns the Secret member for an admin", async () => {
       const result = await run("admin")
       expect(result.data).toEqual({ secret: { __typename: "Secret", value: "42" } })
     })
     it("returns the Forbidden member for a guest", async () => {
       const result = await run("guest")
       expect(result.data).toEqual({ secret: { __typename: "Forbidden", reason: "admin only" } })
     })
   })
   ```

3. **Schema-shape: snapshot the SDL.** `Provider.toSchema(provider)` returns
   the raw `GraphQLSchema`; `printSchema` from `graphql` renders it as SDL.
   Combine with Vitest's `toMatchSnapshot` to catch shape drift in review.

   ```ts twoslash
   import { describe, expect, it } from "vitest"
   import { Effect, Layer, Schema } from "effect"
   import { Rpc } from "effect/unstable/rpc"
   import { printSchema } from "graphql"
   import { Provider } from "effect-graphql"

   class User extends Schema.Class<User>("User")({
     id: Schema.String,
     name: Schema.String,
   }) {}

   class NotFound extends Schema.Class<NotFound>("NotFound")({
     _tag: Schema.Literal("NotFound"),
     message: Schema.String,
   }) {}

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
         resolve: ({ id }) =>
           id === "1"
             ? Effect.succeed(new User({ id: "1", name: "Ada" }))
             : Effect.fail(new NotFound({ _tag: "NotFound", message: `no user ${id}` })),
       }),
     },
   })

   describe("schema shape", () => {
     it("matches the recorded SDL", () => {
       expect(printSchema(Provider.toSchema(provider))).toMatchSnapshot()
     })
     it("derives a UserResult union for the fallible field", () => {
       const sdl = printSchema(Provider.toSchema(provider))
       expect(sdl).toContain("union UserResult = User | NotFound")
       expect(sdl).toContain("user(id: String!): UserResult!")
     })
   })
   ```

   When the shape intentionally changes, regenerate with `bunx vitest -u`
   and commit the updated `.snap` file alongside the source change.
   Reviewers see the exact SDL delta.

4. **HTTP-shape: spawn the server, hit it with `fetch`.** For end-to-end
   coverage — including the transport, JSON encoding, and header wiring —
   spawn the process from `beforeAll` and tear it down in `afterAll`. See
   `packages/core/test/dev-server-smoke.test.ts` for a full example. The
   shape:

   ```ts
   import { spawn, type ChildProcess } from "node:child_process"
   import { afterAll, beforeAll, describe, expect, it } from "vitest"

   const PORT = 3001
   const BASE = `http://localhost:${PORT}`
   let server: ChildProcess

   beforeAll(async () => {
     server = spawn("bun", ["path/to/main.ts"], {
       env: { ...process.env, PORT: String(PORT) },
       stdio: ["ignore", "pipe", "pipe"],
     })
     await new Promise<void>((resolve, reject) => {
       server.stdout?.on("data", (b: Buffer) => {
         if (b.toString().includes("Listening on")) resolve()
       })
       server.once("exit", (code) => reject(new Error(`exit ${code}`)))
     })
   }, 10_000)

   afterAll(() => server?.kill())

   describe("http", () => {
     it("answers a query", async () => {
       const res = await fetch(`${BASE}/graphql`, {
         method: "POST",
         headers: { "content-type": "application/json" },
         body: JSON.stringify({ query: `{ me { id } }` }),
       })
       const json = await res.json() as { readonly data?: { readonly me?: { readonly id: string } } }
       expect(json.data?.me?.id).toBe("u1")
     })
   })
   ```

   `Executor.make` covers everything the resolver body does; the HTTP layer
   only adds transport concerns. Reach for a subprocess test when those
   matter — auth-header wiring, CORS, hardening, GraphiQL page shape.

## Verify

Run the whole suite:

```sh
bun --filter '*' test
```

Every `.test.ts` file under `packages/*/test/` is discovered by Vitest.
Snapshots live under `__snapshots__/`; regenerate with `-u`.

## Related

- [Errors as data](/guides/errors-as-data) — the union member shape asserted
  in step 2.
- [Authorize a field](/guides/authorization) — the auth pattern the
  header-based tests exercise.
- [Serving over HTTP](/guides/serving) — the transport the HTTP-shape
  subprocess test exercises.
