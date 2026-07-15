# Request-scoped tick-batched loaders for N+1

## Status

Superseded by the module-scoped `Provider.batch` implementation shipped in
commit e67fdae. Original design and rationale preserved below.

## Current design

`Provider.batch(tag | rpc, runAll)` returns a callable
`BatchLoader<Tag, Payload, Success>`. Call it from any resolver body with a
payload; concurrent same-fiber-tree calls coalesce into one `runAll`
invocation. The loader also exposes `.tag` (the `Request.tagged` constructor)
and `.resolver` (the `RequestResolver`) as escape hatches for combinators
(`RequestResolver.setDelay`, `batchN`, `withSpan`, `withCache`,
`makeGrouped`).

Loaders are **module-scoped**, not request-scoped. There is no scoped-layer
provisioning, no per-request `Scope` finalizer, no service tag ceremony —
the module-level constant *is* the loader. Effect's `Request` +
`RequestResolver.fromFunctionBatched` handle coalescing, and the resolver's
identity is stable for the process lifetime.

### Why the old sibling-Promise concern no longer applies

ADR 0003 (below) rejected `RequestResolver` alone because graphql-js invokes
sibling field resolvers as independent Promises — Effect's request scheduler
never saw them as one batch. That reasoning assumed each resolver ran under
its own `runPromise`. It doesn't. `Executor.make` runs the whole
`graphql()` call under a single request `Runtime`, and every resolver body
is wrapped as an Effect that resumes on the same request fiber. When two
sibling resolvers both call `loadUser(...)`, they enqueue two
`Request`s against the shared `RequestResolver` inside the same fiber tree;
Effect's scheduler collects them and dispatches one `runAll` batch per
event-loop tick. The graphql-js-imposed microtask boundary that the tick
loader had to paper over is now Effect's normal batching window.

### Cross-request coalescing is a feature

Because loaders are module-scoped, two concurrent GraphQL requests that both
hit the same loader in the same event-loop tick batch together. That's a
deliberate throughput win, not a bug. When you need per-tenant or per-shard
isolation (auth-partitioned data, sharded databases, mixed anonymous +
authenticated traffic against different keys), reach for
`RequestResolver.makeGrouped` on `loader.resolver` — group by the tenant /
shard key so only requests with the same key batch together.

If you need a per-request cache (dedupe repeated identical lookups within one
GraphQL query), pair the resolver with `Effect.withRequestCaching(true)`
inside the request layer. Coalescing (batching) and caching (dedupe) are
independent concerns; the loader's callable form gives you the first,
Effect's request-cache mechanism gives you the second.

### What's still deferred

The current `runAll` signature is
`(payloads: ReadonlyArray<Payload>) => ReadonlyArray<Success>` — pure. A
services-carrying form
`(payloads: ReadonlyArray<Payload>) => Effect.Effect<ReadonlyArray<Success>, E, R>`
is a follow-up: Effect's `RequestResolver.make` typing hasn't been
reconciled with a services channel that flows into the loader's caller
without either widening the `R` on every resolver that calls the loader or
requiring an explicit `Layer` on the call site. For DB / service access
today, drop to `Request.tagged` + `RequestResolver.make` directly and
provide the services in the request layer.

## Original design

We provide a DataLoader-style `createLoader(batchFn)`: calls enqueue keys and flush once per microtask/tick, dispatching `batchFn` once per batch. Loaders are request-scoped — provided via `Layer.scoped` in the request context layer (ADR 0001) — so their queue and cache cannot leak across requests. A loader may use `RequestResolver` underneath for the fetch and dedupe.

### Rationale

We own execution via graphql-js `graphql()`, which invokes sibling field resolvers as independent Promises / separate `runPromise`s. Effect's `RequestResolver` batches only requests collected within a single fiber's structured concurrency, so it never sees sibling resolvers as one batch. A shared request cache yields dedupe but not batching of distinct keys. A per-tick queue (DataLoader's mechanism) is the only thing that collapses N+1 across graphql-js's independent resolutions.

### Considered Options

- **`RequestResolver` + shared request cache only** — rejected: cross-resolver dedupe without cross-sibling batching; the canonical N+1 stays unsolved.
- **No built-in batching** — rejected: a graph that N+1s by default is not production-credible.

### Consequences

- A loader's flush window is tied to the JS microtask/event-loop tick.
- Request-scoped lifetime depends on the request `Layer`/`Scope` from ADR 0001.
- The `Loader.make` / `createLoader` primitive is a first-class artifact of the request layer; anything that batches goes through it.
