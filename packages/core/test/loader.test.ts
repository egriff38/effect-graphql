// Migrated from `Loader` to Effect's `Request` + `RequestResolver`.
//
// The Loader concept was a Promise-backed microtask queue. RequestResolver is
// the same idea with more features: typed errors, tracing, per-resolver caching,
// and integration with Effect's fiber scheduler for automatic batching across
// concurrent `Effect.request(req, resolver)` calls in the same fiber tree.
//
// This test verifies the batching behavior we used to test on `Loader`.

import { Context, Effect, Layer, Request, RequestResolver, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Executor, Provider } from "../src/index.ts";

class Item extends Schema.Class<Item>("Item")({ id: Schema.String }) {}

interface LoadLabel extends Request.Request<string> {
  readonly _tag: "LoadLabel";
  readonly id: string;
}
const LoadLabel = Request.tagged<LoadLabel>("LoadLabel");

class LabelResolver extends Context.Service<
  LabelResolver,
  RequestResolver.RequestResolver<LoadLabel>
>()("test/LabelResolver") {}

describe("request-scoped batched resolver (Effect Request/RequestResolver)", () => {
  it("coalesces same-tick loads across sibling resolvers into one batch call", async () => {
    const batchCalls: Array<ReadonlyArray<string>> = [];

    const provider = Provider.make({
      app: Layer.empty,
      request: Layer.effect(LabelResolver)(
        Effect.sync(() =>
          RequestResolver.fromFunctionBatched<LoadLabel>((entries) => {
            const ids = entries.map((e) => e.request.id);
            batchCalls.push(ids);
            return ids.map((k) => `label:${k}`);
          }),
        ),
      ),
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
          (self) =>
            Effect.flatMap(LabelResolver, (resolver) =>
              Effect.request(LoadLabel({ id: self.id }), resolver),
            ),
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
});
