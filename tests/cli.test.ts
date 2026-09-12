import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

// The CLI drives the built lib/api.js, so `pnpm build` must run before these
// end-to-end tests (the CI workflow builds before testing). Imported
// statically: computed dynamic imports fail under vitest when the project
// path contains non-ASCII characters.
import "../lib/api.js";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../cli.mjs", import.meta.url));

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
  });
  return { stdout, stderr };
}

async function makeDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "dsh-note-cli-"));
}

describe("cli.mjs end to end", () => {
  it("remember appends, recall reads full or tail", async () => {
    const dir = await makeDir();
    await runCli(["remember", dir, "--name", "session.md", "--content", "first decision"]);
    await runCli(["remember", dir, "--name", "session.md", "--content", "second decision"]);
    const full = await runCli(["recall", dir, "--name", "session.md"]);
    expect(full.stdout).toContain("first decision");
    expect(full.stdout).toContain("---");
    expect(full.stdout).toContain("second decision");
    const tail = await runCli(["recall", dir, "--name", "session.md", "--tail", "20"]);
    expect(tail.stdout.trim().length).toBeLessThanOrEqual(21);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("search finds hits and edit rewrites the body in place", async () => {
    const dir = await makeDir();
    await runCli(["remember", dir, "--name", "wip.md", "--content", "alpha beta gamma"]);
    const found = await runCli(["search", dir, "--query", "alpha"]);
    expect(found.stdout).toContain("wip.md");
    const edited = await runCli([
      "edit",
      dir,
      "--name",
      "wip.md",
      "--old",
      "alpha",
      "--new",
      "ALPHA",
      "--all",
    ]);
    expect(edited.stdout).toContain("changed: true");
    const after = await runCli(["recall", dir, "--name", "wip.md"]);
    expect(after.stdout).toContain("ALPHA beta gamma");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("memory bank chain works end to end with tags, types and compaction", async () => {
    const dir = await makeDir();
    await runCli([
      "memory-add",
      dir,
      "--content",
      "user prefers dark mode",
      "--tags",
      "prefs, ui",
      "--type",
      "preference",
    ]);
    await runCli([
      "memory-add",
      dir,
      "--name",
      "decisions.md",
      "--content",
      "decided: pnpm for builds",
      "--type",
      "decision",
    ]);
    const recalled = await runCli(["memory-recall", dir, "--query", "dark mode"]);
    expect(recalled.stdout).toContain("user prefers dark mode");
    const other = await runCli(["memory-recall", dir, "--query", "pnpm"]);
    expect(other.stdout).toContain("pnpm for builds");
    const listed = await runCli(["list", dir]);
    expect(listed.stdout).toContain("[preference]");
    await runCli(["memory-remove", dir, "--name", "memory.md", "--match", "dark mode"]);
    const gone = await runCli(["memory-recall", dir, "--query", "dark mode"]);
    expect(gone.stdout).toContain("no memory matched");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("treats the word help as content, not as the help command", async () => {
    const dir = await makeDir();
    const wrote = await runCli(["write", dir, "--name", "h.md", "--content", "help"]);
    expect(wrote.stdout).toContain("Wrote h.md");
    const read = await runCli(["recall", dir, "--name", "h.md"]);
    expect(read.stdout).toContain("help");
    expect(read.stdout).not.toContain("Usage:");
    const found = await runCli(["search", dir, "--query", "help"]);
    expect(found.stdout).toContain("h.md");
    const asked = await runCli(["help"]);
    expect(asked.stdout).toContain("Usage:");
    const flagged = await runCli(["list", dir, "--help"]);
    expect(flagged.stdout).toContain("Usage:");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("keeps the legacy single-directory listing form", async () => {
    const dir = await makeDir();
    await runCli(["remember", dir, "--name", "session.md", "--content", "hello"]);
    const legacy = await runCli([dir]);
    expect(legacy.stdout).toContain("session.md");
    await fs.rm(dir, { recursive: true, force: true });
  });
});
