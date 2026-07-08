/**
 * Request-scoped, tick-batched loader (DataLoader semantics) — ADR 0003. `load`
 * calls made in the same microtask are coalesced into a single `batch` call, so
 * sibling GraphQL resolvers (which graphql-js invokes as separate fibers in one
 * tick) collapse N+1 fetches into one. Provide the loader in a request `Layer`
 * (`Layer.effect`) so its queue + cache reset per request.
 *
 * @since 0.2.0
 */
import { Effect } from "effect";

/**
 * Request-scoped, tick-batched loader (DataLoader semantics). `load` calls made
 * in the same microtask collapse into a single `batch` call, so sibling GraphQL
 * resolvers over an N-element list don't fan out into N fetches.
 *
 * @example
 * import { Context, Effect, Layer } from "effect"
 * import { Loader } from "effect-graphql"
 *
 * class UserById extends Context.Service<UserById, Loader.Loader<string, { id: string }>>()(
 *   "UserById",
 * ) {}
 *
 * const layer = Layer.effect(UserById)(
 *   Loader.make((ids: ReadonlyArray<string>) =>
 *     Effect.succeed(ids.map((id) => ({ id }))),
 *   ),
 * )
 *
 * @category models
 * @since 0.2.0
 */
export interface Loader<K, V> {
  readonly load: (key: K) => Effect.Effect<V, never, never>;
}

interface Pending<K, V> {
  readonly key: K;
  readonly resolve: (value: V) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Create a loader from a batch function. `batch` receives the coalesced keys
 * and returns one value per key in the same order. Its required services `R`
 * are captured at creation, so `load` itself needs no services and is safe to
 * call from anywhere.
 *
 * @example
 * import { Context, Effect, Layer } from "effect"
 * import { Loader } from "effect-graphql"
 *
 * class UserById extends Context.Service<UserById, Loader.Loader<string, { id: string }>>()(
 *   "UserById",
 * ) {}
 *
 * const layer = Layer.effect(UserById)(
 *   Loader.make((ids: ReadonlyArray<string>) =>
 *     Effect.succeed(ids.map((id) => ({ id }))),
 *   ),
 * )
 *
 * const program = Effect.gen(function* () {
 *   const users = yield* UserById
 *   const user = yield* users.load("u1")
 *   return user
 * })
 *
 * @category constructors
 * @since 0.2.0
 */
export const make = <K, V, E, R>(
  batch: (keys: ReadonlyArray<K>) => Effect.Effect<ReadonlyArray<V>, E, R>,
): Effect.Effect<Loader<K, V>, never, R> =>
  Effect.gen(function*() {
    const context = yield* Effect.context<R>();
    const cache = new Map<K, Promise<V>>();
    let queue: Array<Pending<K, V>> = [];
    let scheduled = false;

    const flush = () => {
      const pending = queue;
      queue = [];
      scheduled = false;
      const keys = pending.map((p) => p.key);
      Effect.runFork(
        batch(keys).pipe(
          Effect.provideContext(context),
          Effect.match({
            onSuccess: (values: ReadonlyArray<V>) => {
              pending.forEach((p, index) => p.resolve(values[index]));
            },
            onFailure: (error: E) => {
              pending.forEach((p) => p.reject(error));
            },
          }),
        ),
      );
    };

    const load = (key: K): Effect.Effect<V, never, never> =>
      Effect.tryPromise(() => {
        const cached = cache.get(key);
        if (cached) return cached;
        const promise = new Promise<V>((resolve, reject) => {
          queue.push({ key, resolve, reject });
          if (!scheduled) {
            scheduled = true;
            queueMicrotask(flush);
          }
        });
        cache.set(key, promise);
        return promise;
      });

    return { load };
  });
