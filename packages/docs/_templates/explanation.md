---
# TEMPLATE — Explanation (Diátaxis: understanding-oriented)
#
# Explanation defends a design decision or clarifies a concept. It is
# discursive: it can say "why" and "what if we didn't". The reader is
# already competent and wants context, not steps.
#
# Rules:
#   1. Title names the concept, not a task or thing. "The two-tier runtime",
#      not "How to configure the runtime".
#   2. Lead with what the concept is, in one sentence.
#   3. Then explain the shape (a diagram is fine).
#   4. Then explain the alternatives that were considered and rejected.
#   5. Link to the relevant ADR if there is one.
---

# <Concept name>

One sentence: what this concept is.

## Shape

Describe the shape. A diagram helps if the concept has parts that relate:

```mermaid
flowchart LR
  A[Thing] --> B[Other thing]
```

Or a plain code sketch:

```ts twoslash
// A snippet that clarifies the shape, not one you'd copy-paste to run.
```

## Why it looks this way

The design trade-off. What we optimize for. What we accept as cost.

## Alternatives considered

- **Alternative A** — reason we didn't pick it.
- **Alternative B** — reason we didn't pick it.

## See also

- Link to the ADR that recorded this decision.
- Link to related Explanation pages.
- Link to how-tos that put this concept to work.
