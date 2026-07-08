---
# TEMPLATE — Tutorial (Diátaxis: learning-oriented)
#
# A tutorial teaches a beginner by walking them through a task that produces
# a real result. It is hand-holding, gentle, and guarantees success at every
# step. It is NOT about coverage — it is about the reader's first win.
#
# Rules:
#   1. First sentence names the concrete artifact the reader will build.
#   2. Every step ends with an observable outcome (something they can see).
#   3. No "why" — that's an Explanation. Just enough context to keep moving.
#   4. No branching decisions ("if you want X..."). One golden path.
#   5. Assume the reader knows TypeScript, but nothing about this library.
---

# Title: an active-verb phrase naming the artifact

One sentence: what the reader will have running by the end.

## Before you start

- Prerequisite 1 (link to install / setup)
- Prerequisite 2

## Step 1: describe the smallest first thing

One or two sentences of context, no more.

```ts twoslash
// A complete, typechecked snippet. No `...` elisions.
```

**Result**: what the reader now has (a file, a running server, output).

## Step 2: build on the previous step

Same shape. Each step is small.

```ts twoslash
// Complete snippet.
```

**Result**: ...

## Step N: the payoff

The final step should produce the artifact the title promised.

## Next

Two links: one deeper concept, one how-to for a related task. No more.
