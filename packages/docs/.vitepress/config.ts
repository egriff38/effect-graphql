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
import { transformerTwoslash } from "@shikijs/vitepress-twoslash";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const coreSrc = resolve(here, "..", "..", "core", "src");

export default defineConfig({
  title: "effect-graphql",
  description: "Derive a GraphQL API from Effect Schema types and Effect-based resolvers.",
  cleanUrls: true,
  srcExclude: ["**/_templates/**", "**/_prompt.md", "**/README.md"],
  themeConfig: {
    nav: [
      { text: "Guides", link: "/guides/" },
      { text: "API Reference", link: "https://effect-graphql.js.org" },
      { text: "GitHub", link: "https://github.com/egriff38/effect-graphql" },
    ],
    sidebar: {
      "/guides/": [
        {
          text: "Getting started",
          items: [{ text: "Quickstart", link: "/guides/quickstart" }],
        },
      ],
    },
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
});
