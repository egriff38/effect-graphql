/**
 * Public API surface for `effect-graphql`.
 *
 * @since 0.1.0
 */

export {
  /**
   * The per-request Context service. See {@link ProviderRequest.Fields} for the
   * plain-data shape adapters populate.
   *
   * @since 0.1.0
   */
  ProviderRequest,
} from "./ProviderRequest.ts";

export type {
  /**
   * Options for query hardening. See {@link Executor.make} for how they attach.
   *
   * @since 0.1.0
   */
  HardeningOptions,
} from "./internal/hardening.ts";

/**
 * Constructors, transports, and the `Provider<...>` type. See {@link Provider}.
 *
 * @since 0.1.0
 */
export * as Provider from "./Provider.ts";

/**
 * Materialize a Provider into a running executor. See {@link Executor}.
 *
 * @since 0.2.0
 */
export * as Executor from "./Executor.ts";

/**
 * Request-scoped tick-batched loader (DataLoader semantics). See {@link Loader}.
 *
 * @since 0.2.0
 */
export * as Loader from "./Loader.ts";
