import { execFile, spawn } from "node:child_process";
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

async function runCli(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    cwd,
  });
  return { stdout, stderr };
}

async function makeDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "dsh-note-cli-"));
}

/**
 * Run the CLI with something on stdin: `--content -`, or the commands typed
 * into the interactive window. No stdio option means all three pipes, which is
 * what makes the streams non-null and the child a non-TTY.
 */
function runCliWithInput(
  args: string[],
  input: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    child.stdin.end(input);
  });
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

  it("exports a folder to a bundle and imports it back", async () => {
    const src = await makeDir();
    const dst = await makeDir();
    const bundle = join(src, "bundle.json");
    await runCli(["remember", src, "--name", "log/today.md", "--content", "bundle body"]);
    const exported = await runCli(["export", src, "--file", bundle]);
    expect(exported.stdout).toContain("Exported 1 file(s)");

    const imported = await runCli(["import", dst, "--file", bundle]);
    expect(imported.stdout).toContain("Imported 1 file(s)");
    expect((await runCli(["recall", dst, "--name", "log/today.md"])).stdout).toContain(
      "bundle body",
    );

    // Restoring twice must not clobber what is already there, unless forced.
    const again = await runCli(["import", dst, "--file", bundle]);
    expect(again.stdout).toContain("skipped 1 existing");
    const forced = await runCli(["import", dst, "--file", bundle, "--force"]);
    expect(forced.stdout).toContain("Imported 1 file(s)");
    await fs.rm(src, { recursive: true, force: true });
    await fs.rm(dst, { recursive: true, force: true });
  });

  it("map outlines a zone in text and as JSON", async () => {
    const dir = await makeDir();
    await runCli([
      "memory-add",
      dir,
      "--name",
      "d.md",
      "--content",
      "decision body",
      "--title",
      "use pnpm",
    ]);
    const text = await runCli(["map", dir, "--zone", "memory"]);
    expect(text.stdout).toContain("memory map: 1 file(s)");
    expect(text.stdout).toContain("use pnpm");
    const json = JSON.parse((await runCli(["map", dir, "--zone", "memory", "--json"])).stdout) as {
      files: { headings: string[] }[];
    };
    expect(json.files[0].headings[0]).toContain("use pnpm");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("mindmap prints a Mermaid block and can write it to a file", async () => {
    const dir = await makeDir();
    await runCli([
      "memory-add",
      dir,
      "--name",
      "d.md",
      "--content",
      "decision body",
      "--title",
      "use pnpm",
    ]);
    const printed = await runCli(["mindmap", dir, "--zone", "memory"]);
    expect(printed.stdout).toContain("```mermaid");
    expect(printed.stdout).toContain('root["memory"]');
    expect(printed.stdout).toContain("use pnpm");

    const out = join(dir, "map.md");
    const written = await runCli(["mindmap", dir, "--zone", "memory", "--file", out]);
    expect(written.stdout).toContain(`Wrote ${out}`);
    expect(await fs.readFile(out, "utf8")).toContain("```mermaid");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("links follows note links, for the zone and for one note", async () => {
    const dir = await makeDir();
    await runCli(["write", dir, "--name", "hub.md", "--content", "See [a](a.md)."]);
    await runCli(["write", dir, "--name", "a.md", "--content", "Back to [[hub]]."]);
    const text = await runCli(["links", dir]);
    expect(text.stdout).toContain("2 file(s), 2 link(s)");
    const one = await runCli(["links", dir, "hub"]); // positional note name
    expect(one.stdout).toContain("hub.md: 1 out, 1 back");
    expect(one.stdout).toContain("back: a.md");
    const json = JSON.parse((await runCli(["links", dir, "--json"])).stdout) as { links: number };
    expect(json.links).toBe(2);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("linkmap draws the link graph as a Mermaid flowchart", async () => {
    const dir = await makeDir();
    await runCli(["write", dir, "--name", "hub.md", "--content", "See [a](a.md)."]);
    await runCli(["write", dir, "--name", "a.md", "--content", "Back to [[hub]]."]);
    const printed = await runCli(["linkmap", dir]);
    expect(printed.stdout).toContain("flowchart LR");
    expect(printed.stdout).toContain('["hub.md"]');
    expect(printed.stdout).toContain("-->");

    const out = join(dir, "graph.md");
    const written = await runCli(["linkmap", dir, "--file", out]);
    expect(written.stdout).toContain(`Wrote ${out}`);
    expect(await fs.readFile(out, "utf8")).toContain("flowchart LR");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rename moves a note and rewrites the links into it", async () => {
    const dir = await makeDir();
    await runCli(["write", dir, "--name", "a.md", "--content", "body"]);
    await runCli(["write", dir, "--name", "hub.md", "--content", "See [[a]]."]);

    const plan = await runCli(["rename", dir, "--from", "a.md", "--to", "b.md", "--dry-run"]);
    expect(plan.stdout).toContain("Would rename a.md -> b.md, 1 link(s) in 1 note(s)");
    expect((await runCli(["recall", dir, "--name", "hub.md"])).stdout).toContain("[[a]]");

    const done = await runCli(["rename", dir, "--from", "a.md", "--to", "b.md"]);
    expect(done.stdout).toContain("Renamed a.md -> b.md");
    expect((await runCli(["recall", dir, "--name", "hub.md"])).stdout).toContain("[[b]]");
    expect((await runCli(["recall", dir, "--name", "b.md"])).stdout).toContain("body");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("stats reports the zone size, in text and as JSON", async () => {
    const dir = await makeDir();
    await runCli(["remember", dir, "--name", "a.md", "--content", "hello"]);
    const plain = await runCli(["stats", dir]);
    expect(plain.stdout).toContain("files: 1");
    expect(plain.stdout).toContain("largest: a.md");
    const json = JSON.parse((await runCli(["stats", dir, "--json"])).stdout) as {
      files: number;
      bytes: number;
    };
    expect(json.files).toBe(1);
    expect(json.bytes).toBeGreaterThan(0);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("applies the zone archive rule to list and search", async () => {
    const dir = await makeDir();
    await runCli(["remember", dir, "--name", "live.md", "--content", "alpha token"]);
    await runCli(["remember", dir, "--name", "old.archive.md", "--content", "alpha token"]);
    // Writing rule: archives included, like note_list/note_search.
    const listed = await runCli(["list", dir]);
    expect(listed.stdout).toContain("live.md");
    expect(listed.stdout).toContain("old.archive.md");
    const found = await runCli(["search", dir, "--query", "alpha"]);
    expect(found.stdout).toContain("old.archive.md");
    // Memory rule: archives hidden.
    const memoryList = await runCli(["list", dir, "--zone", "memory"]);
    expect(memoryList.stdout).toContain("live.md");
    expect(memoryList.stdout).not.toContain("old.archive.md");
    const memorySearch = await runCli(["search", dir, "--query", "alpha", "--zone", "memory"]);
    expect(memorySearch.stdout).toContain("live.md");
    expect(memorySearch.stdout).not.toContain("old.archive.md");
    // --all is still accepted (now redundant) so older invocations keep working.
    const flagged = await runCli(["search", dir, "--query", "alpha", "--all"]);
    expect(flagged.stdout).toContain("old.archive.md");
    await expect(runCli(["list", dir, "--zone", "bogus"])).rejects.toThrow(/--zone must be/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("--zone picks the default folder when no directory is given", async () => {
    const root = await makeDir();
    await runCli(["memory-add", join(root, "memory"), "--content", "bank entry"]);
    await runCli(["write", join(root, "notes"), "--name", "note.md", "--content", "writing entry"]);
    const memory = await runCli(["list", "--zone", "memory"], root);
    expect(memory.stdout).toContain("memory.md");
    expect(memory.stdout).not.toContain("note.md");
    const writing = await runCli(["list"], root);
    expect(writing.stdout).toContain("note.md");
    expect(writing.stdout).not.toContain("memory.md");
    // Reading a zone must not bring it into existence.
    const fresh = await makeDir();
    await runCli(["list", "--zone", "memory"], fresh);
    await expect(fs.stat(join(fresh, "memory"))).rejects.toThrow();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(fresh, { recursive: true, force: true });
  });

  it("exits non-zero with a usage hint on bad input", async () => {
    const dir = await makeDir();
    await expect(runCli(["nope", "arg"])).rejects.toThrow(/unknown command/);
    const failure = runCli(["recall", dir]);
    await expect(failure).rejects.toMatchObject({ code: 1 });
    await expect(failure).rejects.toThrow(/usage: recall/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads content from stdin and from a UTF-8 --file", async () => {
    const dir = await makeDir();
    const src = await makeDir(); // separate folder: a .txt inside the zone would be a note
    const piped = await runCliWithInput(
      ["remember", dir, "--name", "stdin.md", "--content", "-"],
      "line one\nline two\n",
    );
    expect(piped.code).toBe(0);
    const read = await runCli(["recall", dir, "--name", "stdin.md"]);
    expect(read.stdout).toContain("line one");
    expect(read.stdout).toContain("line two");

    const file = join(src, "content.txt");
    await fs.writeFile(file, "中文内容\n", "utf8");
    await runCli(["remember", dir, "--name", "cjk.md", "--file", file]);
    expect((await runCli(["recall", dir, "--name", "cjk.md"])).stdout).toContain("中文内容");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(src, { recursive: true, force: true });
  });

  it("runs the commands typed into the interactive window", async () => {
    const dir = await makeDir();
    await runCli(["remember", dir, "--name", "session.md", "--content", "hello interactive"]);
    const session = await runCliWithInput(
      [],
      `list "${dir}"\nsearch "${dir}" --query interactive\nquit\n`,
    );
    expect(session.code).toBe(0);
    expect(session.stdout).toContain("session.md");
    expect(session.stdout).toContain("hello interactive");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("refuses --content - inside the interactive window", async () => {
    const dir = await makeDir();
    // The prompt owns stdin there, so reading content from it would deadlock.
    const session = await runCliWithInput([], `remember "${dir}" --name x.md --content -\nexit\n`);
    expect(session.stderr).toContain("--content - reads stdin");
    expect(session.code).toBe(0);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
