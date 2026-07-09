// Verifies that a module-scoped `Provider.batch` loader still isolates
// non-overlapping requests: two sequential requests produce two separate
// batches (they're in different event-loop ticks). Concurrent requests would
// batch together — that's the intended cross-request coalescing behavior.

import { Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Executor, Provider } from "../src/index.ts";

describe("cross-request isolation", () => {
  it("sequential requests produce independent batches", async () => {
    const batches: Array<ReadonlyArray<string>> = [];

    const loadLabel = Provider.batch(
      "LoadLabel",
      (payloads: ReadonlyArray<{ id: string }>) => {
        batches.push(payloads.map((p) => p.id));
        return payloads.map((p) => `v:${p.id}`);
      },
    );

    const provider = Provider.make({
      app: Layer.empty,
      request: Layer.empty,
      query: {
        label: Provider.field({
          rpc: Rpc.make("label", { payload: { id: Schema.String }, success: Schema.String }),
          resolve: ({ id }: { id: string }) => loadLabel({ id }),
        }),
      },
    });

    const executor = Executor.make(provider);
    const q = `{ label(id: "1") }`;
    const r1 = await executor.execute({ query: q, request: { method: "POST", url: "/", headers: {}, body: null } });
    const r2 = await executor.execute({ query: q, request: { method: "POST", url: "/", headers: {}, body: null } });

    expect(r1.data).toEqual({ label: "v:1" });
    expect(r2.data).toEqual({ label: "v:1" });
    // Two sequential requests → two separate batches (different event-loop ticks).
    expect(batches.length).toBe(2);
    expect(batches[0]).toEqual(["1"]);
    expect(batches[1]).toEqual(["1"]);
  });
});
