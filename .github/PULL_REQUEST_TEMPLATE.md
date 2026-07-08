<!--
  Reviewer checklist for `effect-graphql`. Delete the sections that don't apply
  to this PR — no need to check off a section that isn't touched.

  For docs PRs, the docs review section is the load-bearing one. For source
  changes, it's usually just the top three items.
-->

## Summary

<!-- One paragraph. What changed and why. Link the issue if there is one. -->

## Verify

- [ ] `bun run typecheck` — clean
- [ ] `bun run test` — every test passes
- [ ] `bun run build` — `dist/` produces

## Docs review (only if this PR touches `packages/docs/` or JSDoc)

- [ ] **Which Diátaxis quadrant does each new page belong to?** Tutorial,
      how-to, reference, or explanation. Don't mix.
- [ ] **Is the goal stated in the first sentence?** No preamble.
- [ ] **Every code sample uses `ts twoslash` fences.** Twoslash typechecked
      every one at build time. No `...` elisions.
- [ ] **Does prose exist only where code can't teach?** Show, don't explain.
- [ ] **No hedge-then-superlative sentences.**
- [ ] **`bun run lint:prose` passes locally.** Vale in CI enforces this too.
- [ ] **No summary section or closing salutation.**

## Notes

<!-- Anything that needed a design call, an override in `.vale.ini`, a
     workaround for a known bug, etc. Include the reasoning so review is
     one round-trip. -->
