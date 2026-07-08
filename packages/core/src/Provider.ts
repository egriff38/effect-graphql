/**
 * Describe a GraphQL API from Effect Schemas and Effect resolvers. A `Provider`
 * is *description*: schemas, resolvers, and the two Layers (app + request) that
 * satisfy the resolvers' `R`. It's cheap to build; it doesn't materialize a runtime.
 *
 * Downstream helpers:
 *   - `Executor.make(provider)` — manual execution (tests, custom transports)
 *   - `Provider.serve(provider)` — effect-platform HttpApp (paved-path GraphQL server)
 *   - `Provider.toRpcGroup` / `rpcHandlersLayer` / `rpcServerLayer` — reify the
 *     Provider's root operations as Effect RPC artifacts.
 *
 * Per-tag typing: `Provider.field` and `Provider.augment` carry their
 * `Rpc.make(...)` type out via `Provider.Field<RPC, R>` / `Provider.Augment<S, RPC, R>`.
 * `Provider.make` accumulates the union of every root op's RPC type into the
 * Provider's `Rpcs` phantom, which the RPC helpers surface without casts.
 *
 * @since 0.1.0
 */
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
 * `Rpc.Payload<R>` / `Rpc.Success<R>` / `Rpc.Error<R>`.
 *
 * The phantom `RPC` parameter is what `Provider.make` reads via mapped types
 * to accumulate the union of every root op, which `Provider.toRpcGroup` surfaces
 * as `RpcGroup<Rpcs>` without casts.
 *
 * @example
 * import { Effect, Schema } from "effect"
 * import { Rpc } from "effect/unstable/rpc"
 * import { Provider } from "effect-graphql"
 *
 * class User extends Schema.Class<User>("User")({ id: Schema.String }) {}
 *
 * const me: Provider.Field<Rpc.Rpc<"me", never, typeof User>, never> =
 *   Provider.field({
 *     rpc: Rpc.make("me", { success: User }),
 *     resolve: () => Effect.succeed(new User({ id: "u1" })),
 *   })
 *
 * @category models
 * @since 0.1.0
 */
export interface Field<out RPC extends Rpc.Any, out R> extends InternalField<R> {
  readonly rpc: RPC;
}

/**
 * A typed augmentation: a relationship field layered onto a parent schema.
 * Carries both the parent shape and the rpc type so `Provider.make` can pick
 * up the union of every augment's rpc alongside the root ops.
 *
 * @example
 * import { Effect, Schema } from "effect"
 * import { Rpc } from "effect/unstable/rpc"
 * import { Provider } from "effect-graphql"
 *
 * class User extends Schema.Class<User>("User")({ id: Schema.String }) {}
 * class Post extends Schema.Class<Post>("Post")({ id: Schema.String, authorId: Schema.String }) {}
 *
 * const authorAugment: Provider.Augment<typeof Post, Rpc.Rpc<"author", never, typeof User>, never> =
 *   Provider.augment(
 *     Post,
 *     Rpc.make("author", { success: User }),
 *     (post) => Effect.succeed(new User({ id: post.authorId })),
 *   )
 *
 * @category models
 * @since 0.1.0
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
 * Declare a root operation (a query or mutation field).
 *
 * The resolver's signature is derived from `options.rpc`'s schemas — the rpc
 * drives inference (`NoInfer` on the resolver positions). Guards may fail with
 * the rpc's declared error type; widening their error union requires extending
 * the rpc's `error` schema.
 *
 * @example
 * import { Effect, Schema } from "effect"
 * import { Rpc } from "effect/unstable/rpc"
 * import { Provider } from "effect-graphql"
 *
 * class User extends Schema.Class<User>("User")({ id: Schema.String, name: Schema.String }) {}
 *
 * const me = Provider.field({
 *   rpc: Rpc.make("me", { success: User }),
 *   resolve: () => Effect.succeed(new User({ id: "u1", name: "Ada" })),
 * })
 *
 * @category constructors
 * @since 0.1.0
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

/**
 * Layer a relationship field onto `schema` (by its identifier). `self` receives
 * the parent object; the resolver returns the related value(s). Augmentations
 * enable graph traversal (`Post.author`, `User.posts`) without editing the
 * schema classes.
 *
 * @example
 * import { Effect, Schema } from "effect"
 * import { Rpc } from "effect/unstable/rpc"
 * import { Provider } from "effect-graphql"
 *
 * class User extends Schema.Class<User>("User")({ id: Schema.String }) {}
 * class Post extends Schema.Class<Post>("Post")({ id: Schema.String, authorId: Schema.String }) {}
 *
 * const postAuthor = Provider.augment(
 *   Post,
 *   Rpc.make("author", { success: User }),
 *   (post) => Effect.succeed(new User({ id: post.authorId })),
 * )
 *
 * @category constructors
 * @since 0.1.0
 */
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

/**
 * Configuration record for `Provider.make`. `AppR` is inferred only from
 * `app`; `ReqR` only from `request`'s output; the field/augment positions are
 * `NoInfer` so they validate (resolver requirements ⊆ `AppR | ReqR`) without
 * polluting inference.
 *
 * @example
 * import { Layer } from "effect"
 * import type { Provider } from "effect-graphql"
 *
 * const config: Provider.Config<never, never, never> = {
 *   app: Layer.empty,
 *   request: Layer.empty,
 *   query: {},
 * }
 *
 * @category models
 * @since 0.1.0
 */
export interface Config<AppR, ReqR, E> {
  readonly app: Layer.Layer<AppR, E, never>;
  readonly request: Layer.Layer<ReqR, E, ProviderRequest | NoInfer<AppR>>;
  readonly query: Record<string, Field<Rpc.Any, NoInfer<AppR> | NoInfer<ReqR>>>;
  readonly mutation?: Record<string, Field<Rpc.Any, NoInfer<AppR> | NoInfer<ReqR>>>;
  readonly augmentations?: ReadonlyArray<Augment<Schema.Top, Rpc.Any, NoInfer<AppR> | NoInfer<ReqR>>>;
}

/** Sentinel key for the phantom Rpcs marker on `Provider`. */
declare const RpcsPhantom: unique symbol;

/**
 * A Provider value. Parameterised by:
 *
 *   - `AppR` — services satisfied by the app Layer
 *   - `ReqR` — services produced by the per-request Layer
 *   - `E`    — error type emitted by either layer
 *   - `Rpcs` — union of every root op's `Rpc.make(...)` type (phantom; flows to `toRpcGroup`)
 *
 * @example
 * import { Layer } from "effect"
 * import { Provider } from "effect-graphql"
 *
 * const p: Provider.Provider<never, never, never> = Provider.make({
 *   app: Layer.empty,
 *   request: Layer.empty,
 *   query: {},
 * })
 *
 * @category models
 * @since 0.1.0
 */
export interface Provider<AppR, ReqR, E, out Rpcs extends Rpc.Any = Rpc.Any> {
  readonly config: Config<AppR, ReqR, E>;
  /** Phantom marker — never read at runtime, used to surface `Rpcs` to consumers. */
  readonly [RpcsPhantom]: (_: never) => Rpcs;
}

/**
 * Construct a Provider from an app Layer, a per-request Layer, and the root
 * operations (queries, mutations, augmentations). The resulting Provider's
 * `Rpcs` phantom carries the union of every root op's rpc type — downstream
 * `Provider.toRpcGroup` uses it to produce a per-tag typed `RpcGroup<Rpcs>`.
 *
 * @example
 * import { Effect, Layer, Schema } from "effect"
 * import { Rpc } from "effect/unstable/rpc"
 * import { Provider } from "effect-graphql"
 *
 * class User extends Schema.Class<User>("User")({ id: Schema.String }) {}
 *
 * const provider = Provider.make({
 *   app: Layer.empty,
 *   request: Layer.empty,
 *   query: {
 *     me: Provider.field({
 *       rpc: Rpc.make("me", { success: User }),
 *       resolve: () => Effect.succeed(new User({ id: "u1" })),
 *     }),
 *   },
 * })
 *
 * @category constructors
 * @since 0.1.0
 */
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

/**
 * Reduce a Provider to a raw `GraphQLSchema` — a pure description-to-description
 * transform, no runtime materialized. Useful for tooling (SDL printing) or for
 * plugging the schema into a foreign server (Yoga, Apollo, Mercurius). The
 * resolvers on this schema depend on the two-tier runtime that only
 * `Executor.make` supplies, so calling `graphql()` on the raw schema directly
 * will fail — use `Executor.make(provider)` or `Provider.serve(provider)`.
 *
 * @example
 * import { Layer } from "effect"
 * import { printSchema } from "graphql"
 * import { Provider } from "effect-graphql"
 *
 * const provider = Provider.make({
 *   app: Layer.empty,
 *   request: Layer.empty,
 *   query: {},
 * })
 * const sdl = printSchema(Provider.toSchema(provider))
 *
 * @category destructors
 * @since 0.1.0
 */
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
// ─────────────────────────────────────────────────────────────────────────────

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * The paved-path effect-platform `HttpApp` serving the Provider: reads a
 * GraphQL request from the body, bridges it to a `ProviderRequest`, executes
 * through the two-tier runtime, and returns JSON. Internally builds one
 * `Executor` (the app runtime materializes once when `serve` is called and is
 * reused per request). Mount it under any `HttpRouter` route.
 *
 * @example
 * import { Layer } from "effect"
 * import { HttpRouter } from "effect/unstable/http"
 * import { Provider } from "effect-graphql"
 *
 * const provider = Provider.make({
 *   app: Layer.empty,
 *   request: Layer.empty,
 *   query: {},
 * })
 * const router = HttpRouter.add("POST", "/graphql", Provider.serve(provider))
 *
 * @category destructors
 * @since 0.1.0
 */
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
 * Reify the Provider's root operations as an Effect `RpcGroup`. Per-tag typing
 * survives: the returned group is `RpcGroup<Rpcs>` where `Rpcs` was accumulated
 * by `Provider.make` — an `RpcClient.make(...)` on the result gets per-tag
 * typing without explicit casts.
 *
 * @example
 * import { Effect, Layer, Schema } from "effect"
 * import { Rpc } from "effect/unstable/rpc"
 * import { Provider } from "effect-graphql"
 *
 * class User extends Schema.Class<User>("User")({ id: Schema.String }) {}
 *
 * const provider = Provider.make({
 *   app: Layer.empty,
 *   request: Layer.empty,
 *   query: {
 *     me: Provider.field({
 *       rpc: Rpc.make("me", { success: User }),
 *       resolve: () => Effect.succeed(new User({ id: "u1" })),
 *     }),
 *   },
 * })
 * const group = Provider.toRpcGroup(provider)
 *
 * @category destructors
 * @since 0.1.0
 */
export const toRpcGroup = <AppR, ReqR, E, Rpcs extends Rpc.Any>(
  provider: Provider<AppR, ReqR, E, Rpcs>,
): RpcGroup.RpcGroup<Rpcs> =>
  RpcGroup.make(...Object.values(rootFields(provider.config)).map((f) => f.rpc)) as
    unknown as RpcGroup.RpcGroup<Rpcs>;

/**
 * Build a Layer providing the handler for every rpc in the Provider's group.
 * Each handler builds a per-request Context from the rpc's headers (mirroring
 * what the GraphQL adapter does from HTTP headers) and runs the field's
 * resolver through the two-tier runtime. Pair with `RpcTest.makeClient(...)`
 * for in-memory testing.
 *
 * @example
 * import { Effect, Layer, Schema } from "effect"
 * import { Rpc } from "effect/unstable/rpc"
 * import { Provider } from "effect-graphql"
 *
 * class User extends Schema.Class<User>("User")({ id: Schema.String }) {}
 *
 * const provider = Provider.make({
 *   app: Layer.empty,
 *   request: Layer.empty,
 *   query: {
 *     me: Provider.field({
 *       rpc: Rpc.make("me", { success: User }),
 *       resolve: () => Effect.succeed(new User({ id: "u1" })),
 *     }),
 *   },
 * })
 * const layer = Provider.rpcHandlersLayer(provider)
 *
 * @category destructors
 * @since 0.1.0
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
 * Layer that mounts an rpc server on `options.path`. Consumes `HttpRouter` from
 * the runtime; provides the handlers layer and JSON serialization internally.
 * Combine with an `HttpRouter` + `HttpServer` layer stack to serve the RPC
 * surface over HTTP.
 *
 * @example
 * import { Effect, Layer, Schema } from "effect"
 * import { Rpc } from "effect/unstable/rpc"
 * import { Provider } from "effect-graphql"
 *
 * class User extends Schema.Class<User>("User")({ id: Schema.String }) {}
 *
 * const provider = Provider.make({
 *   app: Layer.empty,
 *   request: Layer.empty,
 *   query: {
 *     me: Provider.field({
 *       rpc: Rpc.make("me", { success: User }),
 *       resolve: () => Effect.succeed(new User({ id: "u1" })),
 *     }),
 *   },
 * })
 * const server = Provider.rpcServerLayer(provider, { path: "/rpc" })
 *
 * @category destructors
 * @since 0.1.0
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
