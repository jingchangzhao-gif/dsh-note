import type { UserConfig } from "tsdown";

const lib: UserConfig = {
  name: "dsh-note",
  entry: ["src/index.ts", "src/notes.ts"],
  outDir: "lib",
  format: ["esm"],
  platform: "node",
  target: "es2022",
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: ["@deepseek-ai/cordis", "@deepseek-ai/dsh-tools"],
  },
};

export default [lib];
