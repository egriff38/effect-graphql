/**
 * Tree-shakable GraphiQL page helper. Returns an `HttpServerResponse` that
 * serves the standard GraphiQL HTML page from a CDN, configured to POST
 * GraphQL operations against a chosen endpoint. Mount it on any `HttpRouter`
 * route.
 *
 * The GraphQL introspection toggle is enforced at the schema level by
 * `Executor.make` — this helper doesn't gate access; if introspection is
 * disabled the page renders but its docs explorer will be empty.
 *
 * Imported as a subpath so a build that doesn't use it never resolves this file:
 *
 *   import { graphiql } from "effect-graphql/graphiql"
 *
 * @since 0.1.0
 */

import { HttpServerResponse } from "effect/unstable/http";

/**
 * Options controlling the rendered GraphiQL page.
 *
 * @example
 * import type { GraphiQLOptions } from "effect-graphql/graphiql"
 *
 * const opts: GraphiQLOptions = {
 *   endpoint: "/graphql",
 *   title: "My API",
 *   defaultHeaders: { "x-user": "u1" },
 * }
 *
 * @category models
 * @since 0.1.0
 */
export interface GraphiQLOptions {
  /** Path the page will POST GraphQL operations against. Default: `/graphql`. */
  readonly endpoint?: string | undefined;
  /** Browser tab title. Default: `"GraphiQL"`. */
  readonly title?: string | undefined;
  /** Default headers sent with every request (visible/editable in the headers panel). */
  readonly defaultHeaders?: Readonly<Record<string, string>> | undefined;
}

const DEFAULT_ENDPOINT = "/graphql";
const DEFAULT_TITLE = "GraphiQL";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const renderPage = (
  endpoint: string,
  title: string,
  defaultHeaders: Readonly<Record<string, string>>,
): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://unpkg.com/graphiql@2.4.7/graphiql.min.css" />
<style>html,body,#graphiql{height:100%;margin:0;width:100%;overflow:hidden;}</style>
</head>
<body>
<div id="graphiql">Loading…</div>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/graphiql@2.4.7/graphiql.min.js" type="application/javascript"></script>
<script>
  const fetcher = GraphiQL.createFetcher({ url: ${JSON.stringify(endpoint)} });
  const root = ReactDOM.createRoot(document.getElementById("graphiql"));
  root.render(React.createElement(GraphiQL, {
    fetcher,
    defaultEditorToolsVisibility: true,
    defaultHeaders: ${JSON.stringify(JSON.stringify(defaultHeaders, null, 2))},
  }));
</script>
</body>
</html>`;
};

/**
 * Build a GraphiQL response pre-configured to POST against `endpoint`. Mount
 * on any `HttpRouter` route to serve the page from your server.
 *
 * @example
 * import { HttpRouter } from "effect/unstable/http"
 * import { graphiql } from "effect-graphql/graphiql"
 *
 * const router = HttpRouter.add(
 *   "GET",
 *   "/graphiql",
 *   graphiql({ endpoint: "/graphql" }),
 * )
 *
 * @category constructors
 * @since 0.1.0
 */
export const graphiql = (
  options?: GraphiQLOptions,
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.html(renderPage(
    options?.endpoint ?? DEFAULT_ENDPOINT,
    options?.title ?? DEFAULT_TITLE,
    options?.defaultHeaders ?? {},
  ));
