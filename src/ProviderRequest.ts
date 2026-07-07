import { Context } from "effect";

/**
 * The transport-agnostic per-request data every resolver's request Layer can read from.
 * Adapters (effect-platform, native RPC, Yoga, Apollo, …) populate this from their native
 * request, so a Provider's request layer never depends on a concrete server.
 */
export class ProviderRequest extends Context.Service<ProviderRequest, ProviderRequest.Fields>()(
  "effect-graphql/ProviderRequest",
) {}

export declare namespace ProviderRequest {
  /** Plain-data shape adapters populate. */
  export interface Fields {
    readonly method: string;
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: unknown;
  }
}
