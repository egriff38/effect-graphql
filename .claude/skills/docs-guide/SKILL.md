---
name: docs-guide
description: |
  Draft or revise a user-facing guide for the `effect-graphql` documentation
  site. Enforces the Diátaxis quadrant model, uses Twoslash-checked code
  samples, and passes the Vale prose linter and the project's banned-lexicon
  list before yielding. Use when the user says `write a guide for X`,
  `document how to do Y with effect-graphql`, `add a how-to for Z`, or asks
  for docs additions to `packages/docs/`.
---

# Drafting guides for `effect-graphql`

Before writing a single word:

1. **Read `packages/docs/_prompt.md` from top to bottom.** That file defines
   the voice, the banned lexicon, the shape rules, and the local conventions.
   Every rule there is either checked by Vale in CI or enforced at review;
   ignoring any of them wastes a review round-trip.

2. **Pick a Diátaxis quadrant.** Each page belongs to exactly one:
   - Tutorial (`packages/docs/_templates/tutorial.md`) — a beginner's first win
   - How-to (`packages/docs/_templates/how-to.md`) — one task, competent reader
   - Reference (`packages/docs/_templates/reference.md`) — austere lookup
   - Explanation (`packages/docs/_templates/explanation.md`) — the `why`

   Copy the matching template into `packages/docs/guides/` (or a peer
   directory) and fill it in. Do not mix quadrants on one page.

3. **Every code fence uses `ts twoslash`.** Twoslash runs the TypeScript
   compiler at build time. `...` elisions inside a snippet break the build.
   Every import is explicit. Types come from `packages/core/src/` via the
   `paths` alias in `.vitepress/config.ts`.

## While drafting

- The first sentence names the goal. No preamble.
- Present tense, active voice, second person (`you`).
- Sentence-case headings.
- Code identifiers in backticks even inside headings: `## Declare a Provider`.
- Spaced em-dashes are house style (` — `).
- Show, don't explain: the primary teaching artifact is the code sample.
  Prose exists only to state the goal, point at the next step, or call out
  something the type system can't express.

## Banned lexicon

See `_prompt.md` for the full list. Categories to cut:

- Marketing verbs like `delve`, `leverage`, `harness`, `unlock`, `unleash`.
- Empty adjectives like `robust`, `powerful`, `blazing-fast`, `production-ready`.
- Filler openings like `it's worth noting`, `let's dive in`, `note that`.
- Preamble frames like `in today's ... world`, `at the ... of`.
- Summary sandwiches like `in conclusion`, `to sum up`, closing salutations.
- Puff constructions like `not just X, it's Y and Z`.

Vale in CI catches these. Run locally before yielding:

```sh
bun run lint:prose
```

## Before yielding

Run and expect both to pass:

```sh
bun run lint:prose                          # Vale (prose slop plus brand casing)
bun --filter '@effect-graphql/docs' build   # Twoslash (every code sample compiles)
```

If Vale reports errors, fix them at the source. Do not disable the rule
unless the user has already discussed the trade-off and approved it. Style
overrides live in `.vale.ini` under the house-style overrides section and
require a commit that names the rule and the reason.

If Twoslash fails, either the sample has a bug or the API changed. Read the
error, fix the sample. Never wrap in plain `ts` fences without `twoslash` to
suppress the check — that defeats the whole point.

## Cross-linking

- Internal API pages: <https://effect-graphql.js.org/modules/>
- Effect ecosystem: <https://effect-ts.github.io/effect/effect/>
- ADRs live at `packages/core/docs/adr/` and are the source of truth for
  design decisions. Explanations link to the relevant ADR.

## What not to do

- Do not add a `## Conclusion` or `## Summary` section. How-tos and
  reference pages end with what to check or where to look next.
- Do not close a page with a salutation. The reader knows they finished.
- Do not invent code that doesn't exist in `packages/core/src/`. If a helper
  seems useful, propose adding it — don't fake it in a code sample.
- Do not use `pnpm` in install instructions unless the user has explicitly
  asked for a `pnpm` alternative. This project standardizes on `bun`.
