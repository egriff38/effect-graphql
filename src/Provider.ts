// Provider — describe a GraphQL API from Effect Schemas and Effect resolvers.
//
// A Provider is *description*: schemas, resolvers, and the two Layers (app + request) that
// satisfy the resolvers' `R`. It's cheap to build; it doesn't materialize a runtime.
//
// Downstream helpers:
//   - `Executor.make(provider)`      — manual execution (tests, custom transports)
//   - `Provider.serve(provider)`     — effect-platform HttpApp (paved-path GraphQL server)
//   - `Provider.toRpcGroup(provider)`, `Provider.rpcHandlersLayer(provider)`,
//     `Provider.rpcServerLayer(provider, opts)` — reify the Provider's root operations as
//     Effect RPC artifacts, without introducing a name that shadows `effect/unstable/rpc`.
//
// Per-tag typing: `Provider.field` and `Provider.augment` carry their `Rpc.make(...)` type
// out via `Field<RPC, R>` / `Augment<S, RPC, R>`. `Provider.make` accumulates the union of
// every root op's RPC type into the Provider's `Rpcs` phantom, which the RPC helpers below
// surface without casts.

import { Effect, Layer, Record as Rec, SchemaAST as AST } from "effect";
import type { Schema } from "effect";
import type { NoInfer } from "effect/Types";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { HttpRouter } from "effect/unstable/http";
import type { GraphQLSchema } from "graphql";
import { Rpc, RpcGroup, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { ProviderRequest } from "./ProviderRequest.ts";
import { deriveSchema, type InternalAugment, type InternalField } from "./internal/derive.ts";
import type { HardeningOptions } from "./internal/hardening.ts";
import { make as makeExecutor } from "./Executor.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Field / Augment — typed wrappers carrying the RPC type as a phantom for inference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A typed root field. Pairs an `Rpc.make(...)` result with a resolver whose
 * payload, success, and error are derived from the rpc's schemas via
 * `Rpc.Payload<R>`/`Rpc.Success<R>`/`Rpc.Error<R>`.
 *
 * The phantom `RPC` parameter is what `Provider.make` reads via mapped types
 * to build the union of every root op, which `Rpc.toGroup` then surfaces as
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

export interface Config<AppR, ReqR, E> {
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
 *   Rpcs  — union of every root op's `Rpc.make(...)` type (phantom; flows to Rpc.toGroup)
 */
export interface Provider<AppR, ReqR, E, out Rpcs extends Rpc.Any = Rpc.Any> {
  readonly config: Config<AppR, ReqR, E>;
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
// toSchema — pure Provider -> GraphQLSchema transform (no runtime)
// ─────────────────────────────────────────────────────────────────────────────

export const toSchema = <AppR, ReqR, E, Rpcs extends Rpc.Any>(
  provider: Provider<AppR, ReqR, E, Rpcs>,
): GraphQLSchema =>
  deriveSchema<AppR | ReqR>({
    query: provider.config.query,
    mutation: provider.config.mutation,
    augmentations: provider.config.augmentations ?? [],
  });

// ─────────────────────────────────────────────────────────────────────────────
// serve — effect-platform HttpApp
//
// The paved-path one-liner. Reads a GraphQL request from the body, bridges it to a
// ProviderRequest, executes through the two-tier runtime, and returns JSON. Internally
// builds one Executor (the app runtime materializes once when serve is called and is
// reused per request).
// ─────────────────────────────────────────────────────────────────────────────

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export const serve = <AppR, ReqR, E, Rpcs extends Rpc.Any>(
  provider: Provider<AppR, ReqR, E, Rpcs>,
  hardening?: HardeningOptions,
) => {
  const executor = makeExecutor(provider, hardening);
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
// RPC transport — reify a Provider's root operations as Effect RPC artifacts.
//
// Kept on `Provider` (rather than a separate `Rpc` namespace) to avoid shadowing
// `effect/unstable/rpc` inside call sites that also import from Effect's RPC module.
// ─────────────────────────────────────────────────────────────────────────────

/** Merge query + mutation fields into one tag-keyed record (augments are excluded). */
const rootFields = <R>(config: {
  readonly query: Record<string, InternalField<R>>;
  readonly mutation?: Record<string, InternalField<R>> | undefined;
}): Record<string, InternalField<R>> => ({ ...config.query, ...config.mutation });

/**
 * Reify the Provider's root operations as an Effect `RpcGroup`. Per-tag typing survives:
 * the returned group is `RpcGroup<Rpcs>` where `Rpcs` was accumulated by `Provider.make`.
 */
export const toRpcGroup = <AppR, ReqR, E, Rpcs extends Rpc.Any>(
  provider: Provider<AppR, ReqR, E, Rpcs>,
): RpcGroup.RpcGroup<Rpcs> =>
  RpcGroup.make(...Object.values(rootFields(provider.config)).map((f) => f.rpc)) as
    unknown as RpcGroup.RpcGroup<Rpcs>;

/**
 * Build a Layer providing the handler for every rpc in the Provider's group. Each handler
 * builds a per-request Context from the rpc's headers (mirroring what the GraphQL adapter
 * does from HTTP headers) and runs the field's resolver through the two-tier runtime.
 */
export const rpcHandlersLayer = <AppR, ReqR, E, Rpcs extends Rpc.Any>(
  provider: Provider<AppR, ReqR, E, Rpcs>,
): Layer.Layer<Rpc.ToHandler<Rpcs>, E, never> => {
  const group = toRpcGroup(provider);
  const handlers = Rec.map(
    rootFields(provider.config),
    (field) =>
      (
        payload: unknown,
        options: { readonly headers: Readonly<Record<string, string>> },
      ) =>
        Effect.flatMap(
          Layer.build(provider.config.request).pipe(
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

  // `group` and the returned layer are same-shape casts through the erased `Rpc.Any` — the
  // mapped types can't be expressed at this level, but per-tag identity is preserved end to
  // end because handlers are keyed by the same rpc tags as the group.
  const erasedGroup: RpcGroup.RpcGroup<Rpc.Any> = group as unknown as RpcGroup.RpcGroup<Rpc.Any>;
  const layer = erasedGroup.toLayer(handlers as never).pipe(Layer.provide(provider.config.app));
  return layer as unknown as Layer.Layer<Rpc.ToHandler<Rpcs>, E, never>;
};

/**
 * Layer that mounts an rpc server on `options.path`. Consumes `HttpRouter.HttpRouter` from
 * the runtime; requires nothing else because the handlers layer and JSON serialization are
 * provided internally.
 */
export const rpcServerLayer = <AppR, ReqR, E, Rpcs extends Rpc.Any>(
  provider: Provider<AppR, ReqR, E, Rpcs>,
  options: {
    readonly path: HttpRouter.PathInput;
    readonly protocol?: "http" | "websocket" | undefined;
  },
): Layer.Layer<
  never,
  E,
  HttpRouter.HttpRouter | Rpc.Middleware<Rpcs> | Rpc.ServicesServer<Rpcs>
> =>
  RpcServer.layerHttp({
    group: toRpcGroup(provider),
    path: options.path,
    protocol: options.protocol ?? "http",
  }).pipe(
    Layer.provide([rpcHandlersLayer(provider), RpcSerialization.layerJson]),
  );
