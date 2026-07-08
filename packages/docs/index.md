---
layout: home
hero:
  name: effect-graphql
  text: Derive GraphQL from Effect Schema
  tagline: Effect owns the runtime; graphql-js owns the wire.
  actions:
    - theme: brand
      text: Quickstart
      link: /guides/quickstart
    - theme: alt
      text: API Reference
      link: https://effect-graphql.js.org
    - theme: alt
      text: GitHub
      link: https://github.com/egriff38/effect-graphql
features:
  - title: Typed errors as data
    details: Result unions derived from Rpc error schemas. No unhandled channels.
  - title: Two-tier runtime
    details: App-scoped services live once. Request-scoped context rebuilds per call.
  - title: Tick-batched loaders
    details: DataLoader semantics on Effect. Sibling resolvers collapse into one fetch.
---
