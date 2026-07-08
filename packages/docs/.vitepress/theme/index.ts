// Theme override to register the Twoslash floating-tooltip Vue plugin. Without
// this, `[ref=eN]`-style hover types render as plain code — with it, hovering a
// token in any `ts twoslash` block shows the TypeScript-inferred type inline.
import DefaultTheme from "vitepress/theme";
import TwoslashFloatingVue from "@shikijs/vitepress-twoslash/client";
import "@shikijs/vitepress-twoslash/style.css";

import type { Theme } from "vitepress";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.use(TwoslashFloatingVue as never);
  },
} satisfies Theme;
