// Verifies batching semantics of `Provider.batch` — the callable loader
// coalesces concurrent same-tick calls into one `runAll`.

import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Executor, Provider } from "../src/index.ts";

class Item extends Schema.Class<Item>("Item")({ id: Schema.String }) {}

describe("batched loader via Provider.batch", () => {
  it("coalesces same-tick loads across sibling resolvers into one batch call", async () => {
    const batchCalls: Array<ReadonlyArray<string>> = [];

    const loadLabel = Provider.batch(
      "LoadLabel",
      (payloads: ReadonlyArray<{ id: string }>) => {
        const ids = payloads.map((p) => p.id);
        batchCalls.push(ids);
        return ids.map((k) => `label:${k}`);
      },
    );
    const provider = Provider.make({
      app: Layer.empty,
      request: Layer.empty,
      query: {
        items: Provider.field({
          rpc: Rpc.make("items", { success: Schema.Array(Item) }),
          resolve: () =>
            Effect.succeed([new Item({ id: "a" }), new Item({ id: "b" }), new Item({ id: "c" })]),
        }),
      },
      augmentations: [
        Provider.augment(
          Item,
          Rpc.make("label", { success: Schema.String }),
          (self) => loadLabel({ id: self.id }),
        ),
      ],
    });

    const executor = Executor.make(provider);
    const result = await executor.execute({
      query: `{ items { id label } }`,
      request: { method: "POST", url: "/", headers: {}, body: null },
    });
    await executor.dispose();

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      items: [
        { id: "a", label: "label:a" },
        { id: "b", label: "label:b" },
        { id: "c", label: "label:c" },
      ],
    });
    // All three sibling `label` resolves in the same tick — one batch.
    expect(batchCalls).toEqual([["a", "b", "c"]]);
  });

  it("derives payload/success types from an existing Rpc definition", async () => {
    const batchCalls: Array<ReadonlyArray<string>> = [];

    const LabelByIdRpc = Rpc.make("LabelById", {
      payload: { id: Schema.String },
      success: Schema.String,
    });

    // No annotations on runAll — payload + success flow from LabelByIdRpc.
    const loadLabel = Provider.batch(LabelByIdRpc, (payloads) => {
      const ids = payloads.map((p) => p.id);
      batchCalls.push(ids);
      return ids.map((id) => `rpc:${id}`);
    });

    const provider = Provider.make({
      app: Layer.empty,
      request: Layer.empty,
      query: {
        items: Provider.field({
          rpc: Rpc.make("items", { success: Schema.Array(Item) }),
          resolve: () =>
            Effect.succeed([new Item({ id: "x" }), new Item({ id: "y" })]),
        }),
      },
      augmentations: [
        Provider.augment(
          Item,
          Rpc.make("label", { success: Schema.String }),
          (self) => loadLabel({ id: self.id }),
        ),
      ],
    });

    const executor = Executor.make(provider);
    const result = await executor.execute({
      query: `{ items { id label } }`,
      request: { method: "POST", url: "/", headers: {}, body: null },
    });
    await executor.dispose();

    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({
      items: [
        { id: "x", label: "rpc:x" },
        { id: "y", label: "rpc:y" },
      ],
    });
    expect(batchCalls).toEqual([["x", "y"]]);
  });
});
