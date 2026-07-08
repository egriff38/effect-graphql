/**
 * Materialize a `Provider` into a running `Executor`. A Provider is a description
 * (schemas + resolvers + layers); an Executor is what you get when you turn that
 * description into a runtime — an app-scoped `ManagedRuntime` is built once
 * (holding pools, connections, config), and every `execute` call spins up a
 * per-request Context (auth, loaders, per-request state) inside a fresh Scope.
 * Resolvers run on the app runtime with the request context provided.
 *
 * Two-tier runtime — see ADR 0001.
 *
 * @since 0.2.0
 */
import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import {
  type DocumentNode,
  execute as executeDocument,
  type ExecutionResult,
  GraphQLError,
  parse,
  validate,
} from "graphql";
import type { Rpc } from "effect/unstable/rpc";
import { ProviderRequest } from "./ProviderRequest.ts";
import type { RequestContextValue } from "./internal/derive.ts";
import { type HardeningOptions, validationRules } from "./internal/hardening.ts";
import type { Provider } from "./Provider.ts";
import { toSchema } from "./Provider.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Arguments to `Executor.execute`. A single GraphQL operation plus the
 * `ProviderRequest.Fields` for the per-request Layer to consume.
 *
 * @example
 * import type { Executor } from "effect-graphql"
 *
 * const params: Executor.Params = {
 *   query: `{ me { id } }`,
 *   request: { method: "POST", url: "/graphql", headers: {}, body: null },
 * }
 *
 * @category models
 * @since 0.2.0
 */
export interface Params {
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>> | undefined;
  readonly operationName?: string | undefined;
  readonly request: ProviderRequest.Fields;
}

/**
 * A materialized `Provider` — the running instance. `execute` answers one
 * GraphQL operation per call; `dispose` releases the app-scoped
 * `ManagedRuntime` and any resources it holds.
 *
 * @example
 * import { Layer } from "effect"
 * import { Executor, Provider } from "effect-graphql"
 *
 * const provider = Provider.make({
 *   app: Layer.empty,
 *   request: Layer.empty,
 *   query: {},
 * })
 * const executor: Executor.Executor = Executor.make(provider)
 *
 * @category models
 * @since 0.2.0
 */
export interface Executor {
  readonly execute: (params: Params) => Promise<ExecutionResult>;
  readonly dispose: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// make — Provider -> Executor
// ---------------------------------------------------------------------------

/**
 * Materialize a Provider into a running Executor. The app Layer is built once
 * (holding pools, connections, config); a per-request Context is built from
 * the request Layer on every `execute` call. Resolvers run on the app runtime
 * with the per-request Context provided.
 *
 * Call `.dispose()` when the executor is no longer needed — releases the
 * `ManagedRuntime` and any app-scoped resources.
 *
 * @example
 * import { Effect, Layer, Schema } from "effect"
 * import { Rpc } from "effect/unstable/rpc"
 * import { Executor, Provider } from "effect-graphql"
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
 * const executor = Executor.make(provider)
 * const result = await executor.execute({
 *   query: `{ me { id } }`,
 *   request: { method: "POST", url: "/graphql", headers: {}, body: null },
 * })
 * await executor.dispose()
 *
 * @category constructors
 * @since 0.2.0
 */
export const make = <AppR, ReqR, E, Rpcs extends Rpc.Any>(
  provider: Provider<AppR, ReqR, E, Rpcs>,
  hardening?: HardeningOptions,
): Executor => {
  const schema = toSchema(provider);
  const managed = ManagedRuntime.make(provider.config.app);
  const rules = validationRules(hardening);

  const execute = async (params: Params): Promise<ExecutionResult> => {
    let document: DocumentNode;
    try {
      document = parse(params.query);
    } catch (error) {
      return { errors: [error instanceof GraphQLError ? error : new GraphQLError(String(error))] };
    }
    const validationErrors = validate(schema, document, rules);
    if (validationErrors.length > 0) return { errors: validationErrors };

    const scope = Scope.makeUnsafe();
    const requestContext = await managed.runPromise(
      Layer.build(provider.config.request).pipe(
        Effect.provideService(ProviderRequest, params.request),
        Effect.provideService(Scope.Scope, scope),
      ),
    );
    const contextValue: RequestContextValue<AppR | ReqR> = {
      runField: (effect) => managed.runPromise(Effect.provideContext(effect, requestContext)),
      runFieldExit: (effect) => managed.runPromiseExit(Effect.provideContext(effect, requestContext)),
    };
    try {
      return await executeDocument({
        schema,
        document,
        variableValues: params.variables,
        operationName: params.operationName,
        contextValue,
      });
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
    }
  };

  return { execute, dispose: () => managed.dispose() };
};
