/**
 * The transport-agnostic per-request Context service. Every adapter
 * (effect-platform, native RPC, Yoga, Apollo, …) populates `ProviderRequest.Fields`
 * from its native request, so a Provider's request `Layer` never depends on a
 * concrete server.
 *
 * @since 0.1.0
 */
import { Context } from "effect";

/**
 * Context service holding the current request. Every resolver's request Layer
 * can read this and derive per-request state from it (auth, session, request
 * ID, …). Adapters (effect-platform, native RPC, Yoga, Apollo, …) populate the
 * `ProviderRequest.Fields` value from their native request; the Provider's
 * request Layer never depends on a concrete server.
 *
 * @example
 * import { Context, Effect, Layer } from "effect"
 * import { ProviderRequest } from "effect-graphql"
 *
 * class UserId extends Context.Service<UserId, string>()("UserId") {}
 *
 * const requestLayer = Layer.effect(UserId)(
 *   Effect.map(ProviderRequest, (req) => req.headers["x-user"] ?? "anonymous"),
 * )
 *
 * @category constructors
 * @since 0.1.0
 */
export class ProviderRequest extends Context.Service<ProviderRequest, ProviderRequest.Fields>()(
  "effect-graphql/ProviderRequest",
) {}

/**
 * Types declared alongside the `ProviderRequest` service class. Merged with the
 * value-side class via TypeScript declaration merging so `ProviderRequest.Fields`
 * is available from the same identifier.
 *
 * @example
 * import type { ProviderRequest } from "effect-graphql"
 *
 * const fields: ProviderRequest.Fields = {
 *   method: "POST",
 *   url: "/graphql",
 *   headers: {},
 *   body: null,
 * }
 *
 * @category models
 * @since 0.1.0
 */
export declare namespace ProviderRequest {
  /**
   * Plain-data shape adapters populate from their native request. Kept
   * intentionally minimal — everything else (auth, tracing, request ID) is
   * derived by the Provider's request Layer.
   *
   * @example
   * import type { ProviderRequest } from "effect-graphql"
   *
   * const fields: ProviderRequest.Fields = {
   *   method: "POST",
   *   url: "/graphql",
   *   headers: { "x-user": "u1" },
   *   body: null,
   * }
   *
   * @category models
   * @since 0.1.0
   */
  export interface Fields {
    readonly method: string;
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: unknown;
  }
}
