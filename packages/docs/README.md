# @effect-graphql/docs

Documentation site for the `effect-graphql` package.

**Not published.** This workspace member holds the VitePress site source and
Vale config. VitePress builds the site; docgen builds the API reference at
[effect-graphql.js.org](https://effect-graphql.js.org). `pages.yml` in
`.github/workflows/` runs `bun --filter effect-graphql docgen` against
`packages/core` and publishes both sites together.
