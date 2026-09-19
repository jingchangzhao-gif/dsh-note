import { defineConfig } from "vitest/config";

// Coverage is a regression guard on the free local layer that does the real
// work (notes/memory/frontmatter/view/context). src/index.ts is plugin wiring
// and src/api.ts is a re-export barrel, so they carry no logic to cover.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/api.ts"],
      reporter: ["text"],
      // Floor a little under today's numbers: catches a real coverage
      // regression without flapping on small refactors. The remaining branch
      // gaps are defensive arms that defineTool's argument validation makes
      // unreachable (args ?? {}, and the non-string arm of unquote).
      thresholds: {
        statements: 99,
        branches: 82,
        functions: 99,
        lines: 99,
      },
    },
  },
});
