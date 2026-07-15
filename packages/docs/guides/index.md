# Guides

Task-shaped walkthroughs for common `effect-graphql` work.

## Getting started

- [Quickstart](/quickstart) — install, declare one query, run it.
- [Declare root operations](/root-operations) — queries and mutations
  via `Provider.field` and `Rpc.make`.

## How-to

- [Authorize a field](/authorization) — deny a resolver call and
  surface the denial as a typed error union member.
- [Batching](/batching) — coalesce N+1 lookups with `Provider.batch`.
- [Serving over HTTP](/serving) — `Provider.serve`, GraphiQL,
  introspection hardening.
- [Test a `Provider`](/testing) — Vitest patterns for query,
  schema, and HTTP shapes.
- [Yoga, Apollo, Mercurius adapters](/adapters) — plug
  `Provider.toSchema` into an existing GraphQL server.

## Concepts

- [Types and augmentations](/types-vs-augmentations) — `Schema.Class`
  shapes vs `Provider.augment`.
- [Errors as data](/errors-as-data) — how the result union is derived.
- [Why Effect for GraphQL](/why-effect) — differentiators vs Pothos
  and Nexus.

The API reference lives at
[effect-graphql.js.org](https://effect-graphql.js.org).
