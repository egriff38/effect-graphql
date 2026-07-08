/**
 * Bundle config for the published package.
 *
 * - Two entry points: `src/index.ts` (main) and `src/graphiql.ts` (subpath).
 * - ESM only — `package.json` is `"type": "module"` and Node 20+ / Bun handle ESM natively.
 * - Declarations are generated from the same tree, no separate `tsc --emitDeclarationOnly` pass.
 * - `sourcemap: "inline"` embeds source contents in the .map file so debuggers show
 *   real TypeScript without shipping `src/` in the tarball (see #17 Q4).
 * - Peer deps (`effect`, `graphql`) are external — consumers install their own copy.
 */
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/graphiql.ts"],
  format: "esm",
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  external: ["effect", "graphql"],
  target: "es2022",
  platform: "neutral",
});
