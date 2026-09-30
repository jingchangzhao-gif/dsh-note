import { defineConfig } from "vitest/config";

// Coverage is a regression guard on the free local layer that does the real
// work (notes/memory/frontmatter/view/context/stats/links/bundle/rename).
// src/index.ts is plugin wiring, but plugin.test.ts now drives its apply(), so
// it is measured too; src/api.ts stays excluded as a pure re-export barrel.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/api.ts"],
      reporter: ["text"],
      // Floor a little under today's numbers: catches a real coverage
      // regression without flapping on small refactors. The remaining branch
      // gaps are defensive arms that defineTool's argument validation makes
      // unreachable (args ?? {}, and the non-string arm of unquote).
      //
      // `branches` is 81 rather than 82 because the unreadable-file tests are
      // POSIX-only (chmod), so Windows legitimately covers fewer arms and runs
      // ~1 point lower: measured 83.4 on macOS, 82.4 on Windows. The floor is
      // still well above where the suite started (79.5).
      //
      // `statements` is 96: vitest 4+ remaps v8 coverage by AST, counting a
      // ternary arm or a `??` operand as its own statement where vitest 2
      // folded it into its line. The same tests over the same code measured
      // 99.92 statements on vitest 2 and 97.75 on vitest 5 (lines unchanged at
      // 99.92), and Windows runs lower again for the chmod reason above.
      thresholds: {
        statements: 96,
        branches: 81,
        functions: 99,
        lines: 99,
      },
    },
  },
});
