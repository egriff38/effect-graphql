---
# TEMPLATE — How-to (Diátaxis: task-oriented)
#
# A how-to solves ONE specific problem for a reader who already knows the
# basics. It is a recipe, not a lesson. It assumes competence and lists
# ordered steps that reach the goal.
#
# Rules:
#   1. Title is "How to <do the thing>", or the direct task name.
#   2. First sentence is the goal, restated.
#   3. Prerequisites, then numbered steps, then verification.
#   4. No "why" — link to Explanation instead.
#   5. Ends with what to check, not a summary.
---

# How to <do the thing>

Do <the thing> by <sketching the approach in one sentence>.

## Prerequisites

- What must already be in place.
- Link to Tutorial if the reader is here by mistake.

## Steps

1. **Concrete action.** Code sample if it's short.

   ```ts twoslash
   // Complete snippet.
   ```

2. **Next concrete action.** No prose about what you *could* do — just what
   this recipe does.

3. **Final action.**

## Verify

How to confirm the thing works. One check the reader can run.

```ts twoslash
// Verification snippet, or a `curl` / `expect(...)` example.
```

## Related

- Link to the Explanation that covers the underlying concept.
- Link to another how-to that composes with this one.
