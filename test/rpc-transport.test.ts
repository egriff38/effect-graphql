import { Context, Effect, Layer, Schema } from "effect";
import { Rpc, RpcTest } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";
import { Provider } from "../src/index.ts";
import { ProviderRequest } from "../src/ProviderRequest.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class Auth extends Context.Service<Auth, string>()("test/rpc-transport/Auth") {}

const provider = Provider.make({
  app: Layer.empty,
  request: Layer.effect(Auth)(
    Effect.map(ProviderRequest, (req) => req.headers["x-user"] ?? "anonymous"),
  ),
  query: {
    whoami: Provider.field({
      rpc: Rpc.make("whoami", { success: Schema.String, error: Schema.String }),
      resolve: () => Effect.flatMap(Auth, (role) => Effect.succeed(role)),
    }),
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RPC transport (root operations)", () => {
  it("toRpcGroup includes root op tags", () => {
    const group = Provider.toRpcGroup(provider);
    expect([...group.requests.keys()]).toContain("whoami");
  });

  it("rpcHandlersLayer — bridges headers into per-request Context via the handler", async () => {
    // Per-tag typed client: no cast, no flatten — `client.whoami(...)` is fully inferred
    // because Provider.toRpcGroup returns RpcGroup<typeof whoamiRpc>.
    const program = Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(Provider.toRpcGroup(provider));
      return yield* client.whoami(undefined, { headers: { "x-user": "ada" } });
    }).pipe(Effect.scoped, Effect.provide(Provider.rpcHandlersLayer(provider)));

    expect(await Effect.runPromise(program)).toBe("ada");
  });

  it("rpcHandlersLayer — uses fallback when header absent", async () => {
    const program = Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(Provider.toRpcGroup(provider));
      return yield* client.whoami(undefined, { headers: {} });
    }).pipe(Effect.scoped, Effect.provide(Provider.rpcHandlersLayer(provider)));

    expect(await Effect.runPromise(program)).toBe("anonymous");
  });
});
