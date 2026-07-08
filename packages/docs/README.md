# @effect-graphql/docs

Documentation site for the `effect-graphql` package.

**Not published.** This workspace member holds the VitePress site source + Vale
config once #28 (guides) is scaffolded. Until then, it's a placeholder to
reserve the workspace slot.

The auto-generated API reference at [effect-graphql.js.org](https://effect-graphql.js.org)
is built by `.github/workflows/pages.yml`, which runs `bun --filter effect-graphql docgen`
against `packages/core` and publishes the emitted Markdown alongside content
that will land here.
