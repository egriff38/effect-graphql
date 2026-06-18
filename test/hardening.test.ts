import { Effect, Layer, Schema } from "effect";
import { Rpc } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";

class Node extends Schema.Class<Node>("Node")({
  id: Schema.String,
  child: Schema.optionalKey(Schema.suspend((): Schema.Codec<Node> => Node)),
}) {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.empty,
  query: {
    node: Provider.field({
      rpc: Rpc.make("node", { success: Node }),
      resolve: () => Effect.succeed({ id: "1", child: { id: "2", child: { id: "3" } } }),
    }),
  },
});

const run = (executor: ReturnType<typeof Provider.toExecutor>, query: string) =>
  executor.execute({ query, request: { method: "POST", url: "/", headers: {}, body: null } });

describe("hardening", () => {
  it("allows introspection by default", async () => {
    const result = await run(Provider.toExecutor(provider), `{ __schema { queryType { name } } }`);
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ __schema: { queryType: { name: "Query" } } });
  });

  it("rejects introspection when disabled", async () => {
    const executor = Provider.toExecutor(provider, { introspection: false });
    const result = await run(executor, `{ __schema { queryType { name } } }`);
    expect(result.errors).toBeDefined();
    expect((result.errors ?? []).length).toBeGreaterThan(0);
  });

  it("rejects queries deeper than maxDepth, allows shallow ones", async () => {
    const executor = Provider.toExecutor(provider, { maxDepth: 2 });
    const ok = await run(executor, `{ node { id } }`);
    expect(ok.errors).toBeUndefined();

    const tooDeep = await run(executor, `{ node { child { id } } }`);
    expect(tooDeep.errors).toBeDefined();
    expect(tooDeep.errors?.[0]?.message).toMatch(/maximum depth of 2/);
  });
});
