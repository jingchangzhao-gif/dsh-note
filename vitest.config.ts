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
      //
      // `branches` is 81 rather than 82 because the unreadable-file tests are
      // POSIX-only (chmod), so Windows legitimately covers fewer arms and runs
      // ~1 point lower: measured 83.4 on macOS, 82.4 on Windows. The floor is
      // still well above where the suite started (79.5).
      thresholds: {
        statements: 99,
        branches: 81,
        functions: 99,
        lines: 99,
      },
    },
  },
});
