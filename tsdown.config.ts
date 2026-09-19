import type { UserConfig } from "tsdown";

const lib: UserConfig = {
  name: "dsh-note",
  entry: ["src/index.ts", "src/notes.ts", "src/api.ts"],
  outDir: "lib",
  format: ["esm"],
  platform: "node",
  target: "es2022",
  fixedExtension: false,
  dts: false,
  // Wipe lib/ first: hashed shared chunks change name on every content change,
  // so without this a rebuild leaves the previous ones behind and `npm pack`
  // ships all of them.
  clean: true,
  deps: {
    neverBundle: ["@deepseek-ai/cordis", "@deepseek-ai/dsh-tools"],
  },
};

export default [lib];
