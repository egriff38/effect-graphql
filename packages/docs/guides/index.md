# Guides

Task-shaped walkthroughs for common `effect-graphql` work.

## Getting started

- [Quickstart](/guides/quickstart) — install, declare one query, run it.
- [Declare root operations](/guides/root-operations) — queries and mutations
  via `Provider.field` and `Rpc.make`.

## How-to

- [Batching](/guides/batching) — coalesce N+1 lookups with `Provider.batch`.
- [Serving over HTTP](/guides/serving) — `Provider.serve`, GraphiQL,
  introspection hardening.
- [Yoga, Apollo, Mercurius adapters](/guides/adapters) — plug
  `Provider.toSchema` into an existing GraphQL server.

## Concepts

- [Types and augmentations](/guides/types-vs-augmentations) — `Schema.Class`
  shapes vs `Provider.augment`.
- [Errors as data](/guides/errors-as-data) — how the result union is derived.
- [Why Effect for GraphQL](/guides/why-effect) — differentiators vs Pothos
  and Nexus.

The API reference lives at
[effect-graphql.js.org](https://effect-graphql.js.org).
