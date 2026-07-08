import { Context, Effect, Layer, Request, RequestResolver, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Executor, Provider } from "../src/index.ts";

interface LoadLabel extends Request.Request<string> {
  readonly _tag: "LoadLabel";
  readonly id: string;
}
const LoadLabel = Request.tagged<LoadLabel>("LoadLabel");

class L extends Context.Service<L, RequestResolver.RequestResolver<LoadLabel>>()("test/xreq/L") {}

describe("cross-request isolation", () => {
  it("gives each request its own resolver batch queue and finalizes its scope", async () => {
    const batches: Array<ReadonlyArray<string>> = [];
    let finalizes = 0;

    const provider = Provider.make({
      app: Layer.empty,
      request: Layer.effect(L)(
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() => Effect.sync(() => { finalizes++; }));
          return RequestResolver.fromFunctionBatched<LoadLabel>((entries) => {
            const ids = entries.map((e) => e.request.id);
            batches.push(ids);
            return ids.map((id) => `v:${id}`);
          });
        }),
      ),
      query: {
        label: Provider.field({
          rpc: Rpc.make("label", { payload: { id: Schema.String }, success: Schema.String }),
          resolve: ({ id }: { id: string }) =>
            Effect.flatMap(L, (resolver) => Effect.request(LoadLabel({ id }), resolver)),
        }),
      },
    });

    const executor = Executor.make(provider);
    const q = `{ label(id: "1") }`;
    const r1 = await executor.execute({ query: q, request: { method: "POST", url: "/", headers: {}, body: null } });
    const r2 = await executor.execute({ query: q, request: { method: "POST", url: "/", headers: {}, body: null } });

    expect(r1.data).toEqual({ label: "v:1" });
    expect(r2.data).toEqual({ label: "v:1" });
    // Each request builds its own resolver value, so batches are per-request.
    // A shared cross-request cache would produce one batch; isolation => two.
    expect(batches.length).toBe(2);
    // Each request scope finalized.
    expect(finalizes).toBe(2);
  });
});
