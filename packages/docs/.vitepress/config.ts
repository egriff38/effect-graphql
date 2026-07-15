/**
 * VitePress config for the effect-graphql guides site.
 *
 * Twoslash is wired in so every fenced ```ts twoslash``` block runs the TypeScript
 * compiler at build time — every code sample in every guide must typecheck, or
 * the build fails. This mechanically eliminates fabricated-code slop.
 *
 * The `compilerOptions.paths` alias makes `import { ... } from "effect-graphql"`
 * inside guide code samples resolve to the source in `packages/core/src`, so
 * Twoslash type inference matches what a consumer would see after installing
 * the published package.
 */
import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";
import { transformerTwoslash } from "@shikijs/vitepress-twoslash";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const coreSrc = resolve(here, "..", "..", "core", "src");

export default withMermaid(defineConfig({
  title: "effect-graphql",
  description: "Derive a GraphQL API from Effect Schema types and Effect-based resolvers.",
  cleanUrls: true,
  // Served at effect-graphql.js.org/guides/. The docgen-rendered API reference
  // lives at the domain root (Jekyll build); VitePress owns /guides/**.
  base: "/guides/",
  // Guide source is packages/docs/guides/**; nothing else in packages/docs is
  // published. `_templates`, `_prompt.md`, and any README live outside srcDir
  // and are automatically excluded.
  srcDir: "guides",
  themeConfig: {
    nav: [
      { text: "Guides", link: "/" },
      { text: "API Reference", link: "https://effect-graphql.js.org" },
      { text: "GitHub", link: "https://github.com/egriff38/effect-graphql" },
    ],
    // Sidebar links are absolute paths inside the guide tree — VitePress
    // prepends `base` at deploy time, so `/quickstart` renders as
    // `/guides/quickstart` on the site.
    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Quickstart", link: "/quickstart" },
          { text: "Declare root operations", link: "/root-operations" },
        ],
      },
      {
        text: "How-to",
        items: [
          { text: "Authorize a field", link: "/authorization" },
          { text: "Batching", link: "/batching" },
          { text: "Serving over HTTP", link: "/serving" },
          { text: "Test a Provider", link: "/testing" },
          { text: "Yoga, Apollo, Mercurius adapters", link: "/adapters" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Types and augmentations", link: "/types-vs-augmentations" },
          { text: "Errors as data", link: "/errors-as-data" },
          { text: "Why Effect for GraphQL", link: "/why-effect" },
        ],
      },
    ],
  },
  markdown: {
    codeTransformers: [
      // VitePress 1.x ships shiki 2, @shikijs/vitepress-twoslash 3.x ships shiki 3.
      // Their `ShikiTransformer` types don't unify across the dedup boundary but the
      // runtime protocol is compatible. Cast at this single boundary; the transformer
      transformerTwoslash({
        twoslashOptions: {
          compilerOptions: {
            strict: true,
            exactOptionalPropertyTypes: true,
            moduleResolution: 100 /* Bundler */,
            target: 99 /* ESNext */,
            module: 99 /* ESNext */,
            noEmit: true,
            allowImportingTsExtensions: true,
            paths: {
              "effect-graphql": [`${coreSrc}/index.ts`],
              "effect-graphql/graphiql": [`${coreSrc}/graphiql.ts`],
            },
          },
        },
      }) as never,
    ],
  },
}));
