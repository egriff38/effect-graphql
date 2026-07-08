// Public API surface snapshot. Locks the value-side shape of the barrel so:
//
//   1. Adding an accidental re-export shows up in review as a snapshot diff.
//   2. Renaming a namespace or member shows up as both a delete and an add.
//   3. The intent-only surface stays discoverable — one place, one snapshot.
//
// When the surface intentionally changes, run:
//
//   bunx vitest run test/public-api.test.ts -u
//
// and commit the updated `__snapshots__/public-api.test.ts.snap` alongside the
// source change. Reviewers see the exact shape delta.
//
// This test exercises the value-side surface only (`Object.keys(import * as)`);
// types are erased at runtime, so they can't be snapshotted from here. Type-side
// drift shows up in `dist/index.d.ts` diffs at build time.

import { describe, expect, it } from "vitest";
import * as pub from "../src/index.ts";

/** Build a normalized description of the barrel's value-side surface. */
const surface = () => {
  const keys = Object.keys(pub).sort();
  const namespaces: Record<string, ReadonlyArray<string>> = {};
  for (const key of keys) {
    const value = (pub as Record<string, unknown>)[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      namespaces[key] = Object.keys(value as Record<string, unknown>).sort();
    }
  }
  return {
    topLevelExports: keys,
    namespaceMembers: namespaces,
  };
};

describe("public API surface (#9)", () => {
  it("matches the recorded snapshot", () => {
    expect(surface()).toMatchSnapshot();
  });

  it("ProviderRequest is a Context.Service class value", () => {
    // Presence-check that isn't captured well in a shape snapshot: the service
    // class carries a `key` static from Context.Service. If ProviderRequest is
    // ever accidentally re-exported as something else (a bare shape, a symbol,
    // a factory), this fires.
    expect(typeof pub.ProviderRequest).toBe("function");
    expect("key" in pub.ProviderRequest).toBe(true);
  });
});
