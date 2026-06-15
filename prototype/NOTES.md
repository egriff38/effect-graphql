# Prototype — global augmentations over crawl-discovered class schemas

## The model
- Types are pure `Schema.Class` shape — ONE binding each, NO field annotations. They are
  discovered by crawling the root query/mutation rpc success schemas.
- Relationship fields are added on the provider root as a flat list of
  `createAugment(TargetClass, Rpc.make(...), impl)`. The deriver layers them onto the
  discovered types by GraphQL identifier.
- `createAugment(schema, rpc, impl)` types `impl` as
  `(self: schema.Type, ...Parameters<Rpc.ToHandlerFn<rpc>>) => ReturnType<...>` — so `self`,
  the args, AND the return are all type-checked (the return is checked against the Rpc's
  success schema; this caught a real `find() -> undefined` vs non-null `User` bug).

## Why this shape
- Schemas stay clean/inferred (no wrapper, no annotation) — no base/wrapped split.
- Recursion is free: augments live in one list literal referencing already-declared classes,
  so no const cycle forms, and classes are nominal so `success: Schema.Array(Post)` needs no
  `Schema.suspend`.

## Run / verify
```
bun run prototype                     # TUI; 1-4 run queries, q quits
bunx tsc --noEmit -p tsconfig.json    # typecheck (proves typed self/args/return)
```
Verified: tsc clean (strict + exactOptionalPropertyTypes); deep `users -> posts -> author`
resolves; plain-only selection fires no resolvers.

## Open questions / risks (for the real design)
- **No compile-time check that the augmented type exists.** `createAugment(User, ...)` keys by
  the identifier "User" at runtime; augmenting a type not reachable by crawling silently no-ops.
- **No field-name collision detection.** Two augments adding the same field to the same type
  currently last-wins. Should error.
- **Locality tradeoff (deliberate):** relationship fields live at the root, away from the type
  definition — "what fields does User have?" means scanning the augment list. This is a
  schema-extension / federation flavor, intentionally trading locality for clean schemas.
- "Attached to a query directly" — current impl is global (per type). Query-scoped augments
  (a relationship visible only through one query) are unusual for GraphQL; not implemented.

## Still not the question
- `R = never` on resolvers (runPromise); real lib runs on a Runtime providing R.
- Args pass through as graphql-js coerced them; real lib would `Schema.decode` payloads.
- Scalars only; no input/output split, unions, enums, custom scalars, errors-as-data, subs.
- Parked: how deep the Rpc unification goes (full / root-only / tiered).
