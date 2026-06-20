// RPC transport bridge: builds an RpcGroup from root fields and wires handlers through the
// two-tier runtime so every RPC call gets a per-request Context derived from its headers.

import { Effect, Layer, Record as Rec } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import type { InternalField } from "./derive.ts";
import { ProviderRequest } from "../ProviderRequest.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Merge query + mutation fields into a single tag-keyed record (augments are excluded). */
const rootFields = <R>(input: {
  readonly query: Record<string, InternalField<R>>;
  readonly mutation?: Record<string, InternalField<R>> | undefined;
}): Record<string, InternalField<R>> => ({ ...input.query, ...input.mutation });

// ---------------------------------------------------------------------------
// toRpcGroup
// ---------------------------------------------------------------------------

// Generic in `R` because `InternalField`'s `R` is contravariant; `toRpcGroup` ignores `R` at
// the value level so variance is irrelevant here — we only collect `f.rpc` objects.
export const toRpcGroup = <R>(input: {
  readonly query: Record<string, InternalField<R>>;
  readonly mutation?: Record<string, InternalField<R>> | undefined;
}): RpcGroup.RpcGroup<Rpc.Any> =>
  RpcGroup.make(...Object.values(rootFields(input)).map((f) => f.rpc));

// ---------------------------------------------------------------------------
// rpcHandlersLayer
// ---------------------------------------------------------------------------

export const rpcHandlersLayer = <AppR, ReqR, E>(
  group: RpcGroup.RpcGroup<Rpc.Any>,
  input: {
    readonly query: Record<string, InternalField<AppR | ReqR>>;
    readonly mutation?: Record<string, InternalField<AppR | ReqR>> | undefined;
    readonly app: Layer.Layer<AppR, E, never>;
    readonly request: Layer.Layer<ReqR, E, AppR | ProviderRequest>;
  },
): Layer.Layer<Rpc.ToHandler<Rpc.Any>, E, never> => {
  // Build one handler per root field.  The handler builds the per-request Context from RPC
  // headers (mirroring what the GraphQL adapter does from HTTP headers), then runs the field's
  // resolver through it.  `field.run(undefined, payload)` reuses the same closure that powers
  // the GraphQL execution path.
  const handlers = Rec.map(
    rootFields(input),
    (field) =>
      (
        payload: unknown,
        options: { readonly headers: Readonly<Record<string, string>> },
      ) =>
        Effect.flatMap(
          Layer.build(input.request).pipe(
            Effect.provideService(ProviderRequest, {
              method: "RPC",
              url: field.rpc._tag,
              headers: { ...options.headers },
              body: payload,
            }),
          ),
          (requestContext) =>
            Effect.provideContext(field.run(undefined, payload), requestContext),
        ),
  );

  // `group` is `RpcGroup<Rpc.Any>` (erased), so `toLayer` expects a mapped type it cannot
  // express statically.  The dynamic record is correct by construction (keys == rpc tags in
  // the group), so `as never` is the single justified boundary cast here.
  return group.toLayer(handlers as never).pipe(Layer.provide(input.app));
};
