// dsh refuses to load a plugin whose @deepseek-ai/dsh* peer range does not
// satisfy the running runtime. dsh-app-boot's evaluatePluginCompatibility runs
// `semver.satisfies(runtimeVersion, peerRange, { includePrerelease: true })` and
// blocks the install otherwise, printing "Plugin dsh-note@… is incompatible with
// dsh …". dsh-note 0.4.0 pinned the peer to the exact `=0.1.0-rc.8`, so every
// other harness build rejected it even though the API it uses never changed.
//
// The plugin entry is otherwise tested against a stub context (plugin.test.ts),
// which stays green whatever the real registry does. This test keeps the
// declared range honest instead: it must accept every harness version dsh-note
// claims, and the harness the suite actually runs against.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { describe, expect, it } from "vitest";

/** The options dsh-app-boot passes, so a prerelease runtime is judged identically. */
const OPTIONS = { includePrerelease: true } as const;

/** Harness versions this plugin has been checked against, oldest first. */
const SUPPORTED = ["0.1.0-rc.8", "0.1.5-rc.3", "0.1.7-rc.2"];

/** Outside the 0.1 line the tool-registry contract may break, so it is refused. */
const UNSUPPORTED = ["0.0.1-rc.1", "0.2.0-0", "0.2.0-rc.1", "0.2.0", "1.0.0"];

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { peerDependencies?: Record<string, string> };

const range = manifest.peerDependencies?.["@deepseek-ai/dsh-tools"] ?? "";
const message = (version: string) => `${version} vs ${range}`;

/** Version of a devDependency as it is actually installed, not as declared. */
function installedVersion(specifier: string): string {
  const require = createRequire(import.meta.url);
  const file = require.resolve(`${specifier}/package.json`);
  return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
}

describe("dsh runtime compatibility", () => {
  it("declares a dsh-tools peer range", () => {
    expect(range, "package.json peerDependencies").toBeTruthy();
  });

  it("accepts every harness version this plugin supports", () => {
    for (const version of SUPPORTED) {
      expect(semver.satisfies(version, range, OPTIONS), message(version)).toBe(true);
    }
  });

  it("refuses a runtime outside the supported line", () => {
    for (const version of UNSUPPORTED) {
      expect(semver.satisfies(version, range, OPTIONS), message(version)).toBe(false);
    }
  });

  it("accepts the dsh-tools the suite runs against", () => {
    const installed = installedVersion("@deepseek-ai/dsh-tools");
    expect(semver.satisfies(installed, range, OPTIONS), message(installed)).toBe(true);
  });
});
