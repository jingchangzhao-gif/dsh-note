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
// The shared view/read helpers come from the TypeScript sources: lib/ is the
// built bundle the CLI runs, but it ships no .d.ts for tests to import from.
import { readNoteFull } from "../src/notes";
import { compactView, tailView } from "../src/view";

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

  it("returns the same recall views as the shared functions the tools use", async () => {
    const dir = await makeDir();
    // A body long enough to make both the tail and the compact view cut text.
    await runCli(["write", dir, "--name", "long.md", "--content", "z".repeat(3000)]);
    const full = await readNoteFull(dir, "long.md");

    const compact = await runCli(["recall", dir, "--name", "long.md", "--compact", "--json"]);
    const compactJson = JSON.parse(compact.stdout);
    expect(compactJson.content).toBe(compactView(full).content);
    expect(compactJson.truncated).toBe(compactView(full).truncated);

    const tail = await runCli(["recall", dir, "--name", "long.md", "--tail", "50", "--json"]);
    const tailJson = JSON.parse(tail.stdout);
    expect(tailJson.content).toBe(tailView(full, 50).content);
    expect(tailJson.truncated).toBe(tailView(full, 50).truncated);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("keeps the legacy single-directory listing form", async () => {
    const dir = await makeDir();
    await runCli(["remember", dir, "--name", "session.md", "--content", "hello"]);
    const legacy = await runCli([dir]);
    expect(legacy.stdout).toContain("session.md");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("forget, context, memory-update and memory-compact work end to end", async () => {
    const dir = await makeDir();
    const bank = await makeDir();
    await runCli(["remember", dir, "--name", "session.md", "--content", "context marker pnpm"]);
    const context = await runCli([
      "context",
      dir,
      "--focus",
      "pnpm",
      "--notes",
      "session.md",
      "--memory",
      bank,
    ]);
    expect(context.stdout).toContain("context marker pnpm");
    expect(context.stdout).toContain("[context parts:");

    await runCli(["memory-add", bank, "--content", "first bank entry"]);
    await runCli(["memory-add", bank, "--content", "second bank entry"]);
    const updated = await runCli(["memory-update", bank, "--summary", "digest here"]);
    expect(updated.stdout).toContain("changed: true");
    const recalled = await runCli(["memory-recall", bank]);
    expect(recalled.stdout).toContain("summary: digest here"); // the digest reads back

    const compacted = await runCli(["memory-compact", bank, "--name", "memory.md", "--keep", "1"]);
    expect(compacted.stdout).toContain("archived 1");
    const forgotten = await runCli(["forget", dir, "--name", "session.md"]);
    expect(forgotten.stdout).toContain("removed: true");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(bank, { recursive: true, force: true });
  });

  it("prints raw JSON for a command when asked", async () => {
    const dir = await makeDir();
    await runCli(["remember", dir, "--name", "a.md", "--content", "hello"]);
    const listed = await runCli(["list", dir, "--json"]);
    const notes = JSON.parse(listed.stdout) as { name: string }[];
    expect(Array.isArray(notes)).toBe(true);
    expect(notes[0].name).toBe("a.md");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("exits non-zero with a usage hint on bad input", async () => {
    const dir = await makeDir();
    await expect(runCli(["nope", "arg"])).rejects.toThrow(/unknown command/);
    const failure = runCli(["recall", dir]);
    await expect(failure).rejects.toMatchObject({ code: 1 });
    await expect(failure).rejects.toThrow(/usage: recall/);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
