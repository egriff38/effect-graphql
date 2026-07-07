// Public surface. A Provider bundles the type/operation definitions with the app + request
// Layers that satisfy resolver requirements. `AppR | ReqR` is the set of services resolvers may
// require; a resolver requiring anything outside it is a compile error.
//
// Per-tag typing: `Provider.field` and `Provider.augment` carry their `Rpc.make(...)` type out
// (in `Field<RPC, R>` / `Augment<S, RPC, R>`), and `Provider.make` accumulates the union of
// every root op's RPC type. That union flows through to `Provider.toRpcGroup`, producing a
// fully-typed `RpcGroup<Rpcs>` and a per-tag `RpcClient<Rpcs>` — no casts at the test boundary.

import { Effect, Layer, SchemaAST as AST } from "effect";
import type { Schema } from "effect";
import type { NoInfer } from "effect/Types";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { GraphQLSchema } from "graphql";
import type { ProviderRequest } from "./ProviderRequest.ts";
import { deriveSchema, type InternalAugment, type InternalField } from "./internal/derive.ts";
import { type Executor, makeExecutor } from "./internal/runtime.ts";
import type { HardeningOptions } from "./internal/hardening.ts";

import type { Rpc, RpcGroup as RpcGroupNS } from "effect/unstable/rpc";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import type { HttpRouter } from "effect/unstable/http";
import * as InternalRpc from "./internal/rpc.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Field / Augment — typed wrappers carrying the RPC type as a phantom for inference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A typed root field. Pairs an `Rpc.make(...)` result with a resolver whose
 * payload, success, and error are derived from the rpc's schemas via
 * `Rpc.Payload<R>`/`Rpc.Success<R>`/`Rpc.Error<R>`.
 *
 * The phantom `RPC` parameter is what `Provider.make` reads via mapped types
 * to build the union of every root op, which `toRpcGroup` then surfaces as
 * `RpcGroup<Rpcs>`.
 */
export interface Field<out RPC extends Rpc.Any, out R> extends InternalField<R> {
  readonly rpc: RPC;
}

/**
 * A typed augmentation: a relationship field layered onto a parent schema.
 * Carries both the parent shape and the rpc type.
 */
export interface Augment<out S extends Schema.Top, out RPC extends Rpc.Any, out R>
  extends InternalAugment<R>
{
  readonly schema: S;
  readonly rpc: RPC;
}

/** Run authorization/validation guards (each fails with the field's error) before the body. */
const withGuards = <A, E, R>(
  guards: ReadonlyArray<Effect.Effect<void, E, R>> | undefined,
  body: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => (guards && guards.length > 0 ? Effect.flatMap(Effect.all(guards), () => body) : body);

/**
 * Declare a root operation (query/mutation field).
 *
 * The resolver's signature is derived from `options.rpc`'s schemas — the rpc
 * drives inference (`NoInfer` on the resolver positions). Guards may fail with
 * the rpc's declared error type; widening their error union requires extending
 * the rpc's `error` schema.
 */
export const field = <
  const RPC extends Rpc.Any,
  R = never,
>(options: {
  readonly rpc: RPC;
  readonly guards?: ReadonlyArray<Effect.Effect<void, Rpc.Error<NoInfer<RPC>>, R>>;
  readonly resolve: (
    args: Rpc.Payload<NoInfer<RPC>>,
  ) => Effect.Effect<Rpc.Success<NoInfer<RPC>>, Rpc.Error<NoInfer<RPC>>, R>;
}): Field<RPC, R> => {
  // `Rpc.Any` doesn't expose schemas in its public surface; `Rpc.make(...)`
  // returns a value satisfying `Rpc.AnyWithProps`. The cast is sound and
  // localized to this single boundary.
  const rpcWithProps = options.rpc as unknown as Rpc.AnyWithProps;
  const internal: InternalField<R> = {
    rpc: options.rpc,
    payloadSchema: rpcWithProps.payloadSchema as Schema.Codec<unknown>,
    successSchema: rpcWithProps.successSchema,
    errorSchema: rpcWithProps.errorSchema,
    // graphql-js provides args matching the payload schema this field was derived from.
    run: (_source, args) =>
      withGuards(options.guards, options.resolve(args as Rpc.Payload<RPC>)),
  };
  return internal as Field<RPC, R>;
};

/** Layer a relationship field onto `schema` (by its identifier). `self` is the parent. */
export const augment = <
  S extends Schema.Top,
  const RPC extends Rpc.Any,
  R = never,
>(
  schema: S,
  rpc: RPC,
  impl: (
    self: S["Type"],
    args: Rpc.Payload<NoInfer<RPC>>,
  ) => Effect.Effect<Rpc.Success<NoInfer<RPC>>, Rpc.Error<NoInfer<RPC>>, R>,
  guards?: ReadonlyArray<Effect.Effect<void, Rpc.Error<NoInfer<RPC>>, R>>,
): Augment<S, RPC, R> => {
  const identifier = AST.resolveIdentifier(schema.ast);
  if (!identifier) {
    throw new Error("effect-graphql: augment target schema has no identifier (use Schema.Class or annotate it)");
  }
  const rpcWithProps = rpc as unknown as Rpc.AnyWithProps;
  const internalField: InternalField<R> = {
    rpc,
    payloadSchema: rpcWithProps.payloadSchema as Schema.Codec<unknown>,
    successSchema: rpcWithProps.successSchema,
    errorSchema: rpcWithProps.errorSchema,
    // parent and args are provided by the GraphQL executor at the shapes derived here.
    run: (source, args) =>
      withGuards(guards, impl(source as S["Type"], args as Rpc.Payload<RPC>)),
  };
  return {
    schema,
    rpc,
    identifier,
    fieldName: rpcWithProps._tag,
    field: internalField,
  } as Augment<S, RPC, R>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider type + make — accumulates the union of every root op's RPC type
// ─────────────────────────────────────────────────────────────────────────────

/** Extracts the union of RPC types from a record of `Field` values. */
type FieldRpcs<F> = F extends Record<string, Field<infer RPC, any>> ? RPC : never;

/** Extracts the union of RPC types from an array of `Augment` values. */
type AugmentRpcs<A> = A extends ReadonlyArray<Augment<any, infer RPC, any>> ? RPC : never;

export interface ProviderConfig<AppR, ReqR, E> {
  // `AppR` is inferred only from `app`, `ReqR` only from `request`'s output; the other
  // positions are `NoInfer` so they validate (resolver requirements ⊆ AppR | ReqR) without
  // polluting inference (otherwise `request`'s RIn could degenerately fix `AppR`).
  readonly app: Layer.Layer<AppR, E, never>;
  readonly request: Layer.Layer<ReqR, E, ProviderRequest | NoInfer<AppR>>;
  readonly query: Record<string, Field<Rpc.Any, NoInfer<AppR> | NoInfer<ReqR>>>;
  readonly mutation?: Record<string, Field<Rpc.Any, NoInfer<AppR> | NoInfer<ReqR>>>;
  readonly augmentations?: ReadonlyArray<Augment<Schema.Top, Rpc.Any, NoInfer<AppR> | NoInfer<ReqR>>>;
}

/** Sentinel key for the phantom Rpcs marker on `Provider`. */
declare const RpcsPhantom: unique symbol;

/**
 * A Provider value, parameterised by:
 *   AppR  — services satisfied by the app Layer
 *   ReqR  — services produced by the per-request Layer
 *   E     — error type emitted by either layer
 *   Rpcs  — union of every root op's `Rpc.make(...)` type (phantom; flows to toRpcGroup)
 */
export interface Provider<AppR, ReqR, E, out Rpcs extends Rpc.Any = Rpc.Any> {
  readonly config: ProviderConfig<AppR, ReqR, E>;
  /** Phantom marker — never read at runtime, used to surface `Rpcs` to consumers. */
  readonly [RpcsPhantom]: (_: never) => Rpcs;
}

export const make = <
  AppR,
  ReqR,
  E,
  const Q extends Record<string, Field<Rpc.Any, AppR | ReqR>>,
  const M extends Record<string, Field<Rpc.Any, AppR | ReqR>> = {},
  const A extends ReadonlyArray<Augment<Schema.Top, Rpc.Any, AppR | ReqR>> = [],
>(config: {
  readonly app: Layer.Layer<AppR, E, never>;
  readonly request: Layer.Layer<ReqR, E, ProviderRequest | NoInfer<AppR>>;
  readonly query: Q;
  readonly mutation?: M;
  readonly augmentations?: A;
}): Provider<AppR, ReqR, E, FieldRpcs<Q> | FieldRpcs<M> | AugmentRpcs<A>> =>
  ({ config } as unknown as Provider<AppR, ReqR, E, FieldRpcs<Q> | FieldRpcs<M> | AugmentRpcs<A>>);

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL deriver / executor / serve — unchanged behaviour, generics widened
// ─────────────────────────────────────────────────────────────────────────────

export const toSchema = <AppR, ReqR, E, Rpcs extends Rpc.Any>(
  provider: Provider<AppR, ReqR, E, Rpcs>,
): GraphQLSchema =>
  deriveSchema<AppR | ReqR>({
    query: provider.config.query,
    mutation: provider.config.mutation,
    augmentations: provider.config.augmentations ?? [],
  });

export const toExecutor = <AppR, ReqR, E, Rpcs extends Rpc.Any>(
  provider: Provider<AppR, ReqR, E, Rpcs>,
  hardening?: HardeningOptions,
): Executor => makeExecutor(toSchema(provider), provider.config.app, provider.config.request, hardening);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * An effect-platform HttpApp serving the Provider: reads a GraphQL request from the body,
 * bridges it to a ProviderRequest, executes through the two-tier runtime, and returns JSON.
 * The app runtime is built once when `serve` is called and reused per request.
 */
export const serve = <AppR, ReqR, E, Rpcs extends Rpc.Any>(
  provider: Provider<AppR, ReqR, E, Rpcs>,
  hardening?: HardeningOptions,
) => {
  const executor = toExecutor(provider, hardening);
  return Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    const params = asRecord(body) ?? {};
    const result = yield* Effect.promise(() =>
      executor.execute({
        query: asString(params["query"]) ?? "",
        variables: asRecord(params["variables"]),
        operationName: asString(params["operationName"]),
        request: { method: request.method, url: request.url, headers: { ...request.headers }, body },
      })
    );
    return yield* HttpServerResponse.json(result);
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// RPC transport — typed all the way through to the client
// ─────────────────────────────────────────────────────────────────────────────

export const toRpcGroup = <AppR, ReqR, E, Rpcs extends Rpc.Any>(
  provider: Provider<AppR, ReqR, E, Rpcs>,
): RpcGroupNS.RpcGroup<Rpcs> =>
  InternalRpc.toRpcGroup(provider.config) as unknown as RpcGroupNS.RpcGroup<Rpcs>;

export const rpcHandlersLayer = <AppR, ReqR, E, Rpcs extends Rpc.Any>(
  provider: Provider<AppR, ReqR, E, Rpcs>,
): Layer.Layer<Rpc.ToHandler<Rpcs>, E, never> =>
  InternalRpc.rpcHandlersLayer(
    toRpcGroup(provider) as unknown as RpcGroupNS.RpcGroup<Rpc.Any>,
    provider.config,
  ) as unknown as Layer.Layer<Rpc.ToHandler<Rpcs>, E, never>;

export const rpcServerLayer = <AppR, ReqR, E, Rpcs extends Rpc.Any>(
  provider: Provider<AppR, ReqR, E, Rpcs>,
  options: { readonly path: HttpRouter.PathInput; readonly protocol?: "http" | "websocket" | undefined },
): Layer.Layer<never, E, HttpRouter.HttpRouter | Rpc.Middleware<Rpcs> | Rpc.ServicesServer<Rpcs>> =>
  RpcServer.layerHttp({ group: toRpcGroup(provider), path: options.path, protocol: options.protocol ?? "http" }).pipe(
    Layer.provide([rpcHandlersLayer(provider), RpcSerialization.layerJson]),
  );
