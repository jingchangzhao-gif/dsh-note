#!/usr/bin/env node
// Guard the install path: `dsh plugin add` installs this package, so the packed
// tarball has to carry the built plugin, the CLI and the bundle registration.
// lib/ is generated and git-ignored, which is exactly how this can silently
// regress — the tarball would install and then fail to load.

import { execFileSync } from "node:child_process";

const REQUIRED = ["package.json", "cli.mjs", "lib/index.js", "lib/api.js", "cordis.patch.yml"];

// The check inspects an artifact CI has already built, so pack must not build
// again: `--ignore-scripts` alone proved unreliable (CI still ran `prepare`),
// hence the env var too. Even then, npm's lifecycle output can land in stdout,
// so the JSON is read by its own lines rather than by offset.
const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  env: { ...process.env, npm_config_ignore_scripts: "true" },
});

/** Pull npm's pretty-printed array out of whatever else was printed. */
function packJson(output) {
  const lines = output.split("\n");
  const start = lines.lastIndexOf("[");
  const end = lines.indexOf("]", start);
  if (start < 0 || end < 0) {
    throw new Error(`no pack JSON in npm output:\n${output.slice(0, 400)}`);
  }
  return JSON.parse(lines.slice(start, end + 1).join("\n"));
}

const files = packJson(raw)[0].files.map((file) => file.path);
const missing = REQUIRED.filter((name) => !files.includes(name));
if (missing.length > 0) {
  console.error(`missing from the tarball: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`tarball carries ${files.length} files, including all ${REQUIRED.length} required`);
