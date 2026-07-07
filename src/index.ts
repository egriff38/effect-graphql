// Public API surface. See docs/adr/ for the design decisions behind each namespace.
//
// Each named export is *both* a namespace (for `Loader.make`) and a type
// (for `Loader<K, V>`). TypeScript declaration merging permits a value and a
// type to share an identifier, so consumers write:
//
//   import { Loader } from "effect-graphql"
//   const loader: Loader<string, User> = yield* Loader.make(batch)

import * as ProviderNS from "./Provider.ts";
import type { Provider as ProviderT } from "./Provider.ts";
import * as ExecutorNS from "./Executor.ts";
import type { Executor as ExecutorT } from "./Executor.ts";
import * as LoaderNS from "./Loader.ts";
import type { Loader as LoaderT } from "./Loader.ts";

// Value bindings
export const Provider = ProviderNS;
export const Executor = ExecutorNS;
export const Loader = LoaderNS;

// Type merges — same identifier, type-side
export type Provider<AppR, ReqR, E, Rpcs extends import("effect/unstable/rpc").Rpc.Any = import("effect/unstable/rpc").Rpc.Any> = ProviderT<AppR, ReqR, E, Rpcs>;
export type Executor = ExecutorT;
export type Loader<K, V> = LoaderT<K, V>;

export { ProviderRequest } from "./ProviderRequest.ts";
export type { HardeningOptions } from "./internal/hardening.ts";
