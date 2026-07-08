/**
 * Bun-backed dev server for the blog Provider.
 *
 *   bun --hot examples/dev-server/main.ts
 *
 * Then open http://localhost:3000/graphiql and play. Run a query (no headers
 * needed for read paths). Try `mutation { createPost(...) }` — you'll get
 * `Forbidden` until you set `x-user: u1` in GraphiQL's Headers panel.
 *
 * Architecture: the canonical effect-platform-bun stack — `HttpRouter.serve`
 * provides routes, `BunHttpServer.layer` binds the port, `BunRuntime.runMain`
 * handles signals + graceful shutdown. `Provider.serve(provider)` is the
 * GraphQL HttpApp (already wraps the two-tier runtime); `graphiql(...)` is the
 * static IDE page from the tree-shakable subpath export.
 *
 * Hot reload: `bun --hot` re-evaluates this file on save, picking up any
 * changes to schema/resolvers (which live in `provider.ts`/`domain.ts`).
 * State in `store.ts` resets per save (the simplest of Q5's options); pin to
 * `globalThis` if you want mutations to survive saves while iterating.
 */

import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Provider } from "../../packages/core/src/index.ts";
import { graphiql } from "../../packages/core/src/graphiql.ts";
import { provider } from "./provider.ts";

// Routes — both endpoints under the same router.
const Routes = Layer.mergeAll(
  HttpRouter.add("POST", "/graphql", Provider.serve(provider)),
  HttpRouter.add("GET", "/graphiql", graphiql({
    endpoint: "/graphql",
    title: "Blog Dev",
    // GraphiQL's Headers panel starts populated; the user can edit them in place.
    defaultHeaders: { "x-user": "u1" },
  })),
);

// Server — Routes provided to a Bun HttpServer bound on $PORT (default 3000).
const PORT = process.env["PORT"] ? Number.parseInt(process.env["PORT"], 10) : 3000;
const Server = HttpRouter.serve(Routes).pipe(
  Layer.provide(BunHttpServer.layer({ port: PORT })),
);

BunRuntime.runMain(Layer.launch(Server));
