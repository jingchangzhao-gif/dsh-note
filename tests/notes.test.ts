import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  appendNote,
  deleteNote,
  editNote,
  listNotes,
  notePath,
  readNote,
  readNoteFull,
  resolveMemoryDir,
  searchNotes,
  writeNote,
  zoneRoot,
} from "../src/notes";

async function makeDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "dsh-note-"));
}

describe("notes memory operations", () => {
  it("appendNote creates a note and appends with a separator", async () => {
    const dir = await makeDir();
    await appendNote(dir, "session.md", "first");
    await appendNote(dir, "session.md", "second");
    const text = await readNote(dir, "session.md");
    expect(text).toContain("first");
    expect(text).toContain("---");
    expect(text).toContain("second");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("readNote tail returns only the recent characters", async () => {
    const dir = await makeDir();
    await appendNote(dir, "a.md", "x".repeat(500));
    const tail = await readNote(dir, "a.md", 50);
    expect(tail.length).toBeLessThanOrEqual(51); // may include leading "…"
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("listNotes filters to note extensions and reads titles", async () => {
    const dir = await makeDir();
    await appendNote(dir, "one.md", "# One\nbody");
    await appendNote(dir, "two.txt", "plain");
    await fs.writeFile(join(dir, "skip.js"), "no");
    const notes = await listNotes(dir);
    expect(notes.map((n) => n.name)).toEqual(["one.md", "two.txt"]);
    expect(notes[0].title).toBe("One");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("listNotes supports nested names and hides dotfiles", async () => {
    const dir = await makeDir();
    await appendNote(dir, "log/today.md", "# Today\nhi");
    await fs.writeFile(join(dir, ".hidden.md"), "secret");
    const notes = await listNotes(dir);
    expect(notes.map((n) => n.name)).toEqual(["log/today.md"]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads a missing zone as empty without creating it", async () => {
    const root = await makeDir();
    const zone = join(root, "notes");
    expect(await listNotes(zone)).toEqual([]);
    expect(await searchNotes(zone, "anything")).toEqual([]);
    await expect(fs.stat(zone)).rejects.toThrow(); // still absent: reads don't write
    await fs.rm(root, { recursive: true, force: true });
  });

  it("deleteNote removes a file and reports false when absent", async () => {
    const dir = await makeDir();
    await appendNote(dir, "gone.md", "hi");
    expect(await deleteNote(dir, "gone.md")).toBe(true);
    expect(await deleteNote(dir, "gone.md")).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("resolveMemoryDir defaults to ./notes under cwd", () => {
    expect(resolveMemoryDir("/w", undefined)).toBe(resolve(join("/w", "notes")));
    expect(resolveMemoryDir("/w", "/abs/dir")).toBe(resolve("/abs/dir"));
  });

  it("zones default to ./notes (writing) and ./memory (memory)", () => {
    expect(zoneRoot("writing", "/w", undefined)).toBe(resolve(join("/w", "notes")));
    expect(zoneRoot("memory", "/w", undefined)).toBe(resolve(join("/w", "memory")));
    expect(zoneRoot("memory", "/w", "/elsewhere")).toBe(resolve("/elsewhere"));
  });

  it("notePath blocks traversal but allows nested names", async () => {
    const dir = await makeDir();
    expect(() => notePath(dir, "../evil.md")).toThrow();
    expect(() => notePath(dir, "a/../../evil.md")).toThrow();
    await appendNote(dir, "log/today.md", "hi");
    const notes = await listNotes(dir);
    expect(notes.map((n) => n.name)).toEqual(["log/today.md"]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writeNote fully replaces the body and merges front matter", async () => {
    const dir = await makeDir();
    const created = await writeNote(dir, "a.md", "first body", { title: "A", tags: "one, two" });
    expect(created.created).toBe(true);
    const full = await readNoteFull(dir, "a.md");
    expect(full.body).toBe("first body");
    expect(full.meta.title).toBe("A");
    expect(full.meta.tags).toBe("one, two");
    expect(full.meta.created).toBeTruthy();
    expect(full.meta.updated).toBeTruthy();

    const updated = await writeNote(dir, "a.md", "second body", { title: "Renamed" });
    expect(updated.created).toBe(false);
    const full2 = await readNoteFull(dir, "a.md");
    expect(full2.body).toBe("second body");
    expect(full2.body).not.toContain("first body");
    expect(full2.meta.title).toBe("Renamed");
    expect(full2.meta.tags).toBe("one, two"); // untouched keys are preserved
    expect(full2.meta.created).toBe(full.meta.created); // created never resets
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("editNote replaces literal text in the body only, keeping front matter", async () => {
    const dir = await makeDir();
    await writeNote(dir, "a.md", "foo bar foo\nsecond line", { title: "T", summary: "keep me" });
    const one = await editNote(dir, "a.md", [{ old: "foo", new: "baz" }]);
    expect(one.changed).toBe(true);
    expect(one.edits).toBe(1);
    const all = await editNote(dir, "a.md", [{ old: "line", new: "LINE", all: true }]);
    expect(all.edits).toBe(1);
    const full = await readNoteFull(dir, "a.md");
    expect(full.body).toBe("baz bar foo\nsecond LINE");
    expect(full.meta.summary).toBe("keep me");
    expect(full.meta.title).toBe("T");
    const none = await editNote(dir, "a.md", [{ old: "absent", new: "x" }]);
    expect(none.changed).toBe(false);
    expect(none.edits).toBe(0);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("keeps a leading rule in the body when the note is rewritten", async () => {
    const dir = await makeDir();
    const body = "---\nplain intro line\n---\n\nreal body text";
    await writeNote(dir, "rule.md", body);
    expect((await readNoteFull(dir, "rule.md")).body).toContain("plain intro line");
    await editNote(dir, "rule.md", [{ old: "real body text", new: "EDITED body" }]);
    const text = await readNote(dir, "rule.md");
    expect(text).toContain("plain intro line"); // survived the rewrite
    expect(text).toContain("EDITED body");
    expect(text).not.toContain("updated:"); // and no front matter was invented
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("appendNote keeps the front matter and refreshes updated", async () => {
    const dir = await makeDir();
    await writeNote(dir, "a.md", "first", { title: "A" });
    const before = (await readNoteFull(dir, "a.md")).meta.updated;
    await new Promise((done) => setTimeout(done, 5));
    await appendNote(dir, "a.md", "second");
    const full = await readNoteFull(dir, "a.md");
    expect(full.meta.title).toBe("A");
    expect(full.body).toContain("first");
    expect(full.body).toContain("second");
    expect(full.meta.updated).not.toBe(before);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("lists a note whose front matter is larger than the head chunk", async () => {
    const dir = await makeDir();
    await writeNote(dir, "big.md", "body text", { title: "Big", summary: "s".repeat(20_000) });
    const notes = await listNotes(dir);
    expect(notes.map((note) => note.name)).toEqual(["big.md"]);
    expect(notes[0].title).toBe("Big");
    expect(notes[0].meta.summary).toHaveLength(20_000);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("lists a CJK note whose head cut splits a multi-byte character", async () => {
    const dir = await makeDir();
    // 3-byte characters: the 16 KiB head chunk lands mid-character, which is
    // exactly the case readHead's shorter-slice retry exists for.
    const body = `# 標題\n${"漢".repeat(8000)}`;
    await writeNote(dir, "cjk.md", body);
    const notes = await listNotes(dir);
    expect(notes.map((note) => note.name)).toEqual(["cjk.md"]);
    expect(notes[0].title).toBe("標題");
    expect(await readNote(dir, "cjk.md")).toContain(body);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "skips unreadable files and subdirectories instead of failing the listing",
    async () => {
      const dir = await makeDir();
      await appendNote(dir, "good.md", "visible body");
      await appendNote(dir, "locked/hidden.md", "hidden body");
      await fs.writeFile(join(dir, "secret.md"), "secret body");
      await fs.chmod(join(dir, "locked"), 0o000);
      await fs.chmod(join(dir, "secret.md"), 0o000);
      try {
        const notes = await listNotes(dir);
        expect(notes.map((note) => note.name)).toEqual(["good.md"]);
        const hits = await searchNotes(dir, "body");
        expect(hits.map((hit) => hit.name)).toEqual(["good.md"]);
      } finally {
        await fs.chmod(join(dir, "locked"), 0o755);
        await fs.chmod(join(dir, "secret.md"), 0o644);
      }
      await fs.rm(dir, { recursive: true, force: true });
    },
  );

  it("reports nested names zone-relative and leaves no temp files behind", async () => {
    const dir = await makeDir();
    const appended = await appendNote(dir, "log/today.md", "first");
    expect(appended.name).toBe("log/today.md");
    await writeNote(dir, "log/today.md", "replaced body", { title: "Today" });
    const edited = await editNote(dir, "log/today.md", [{ old: "replaced", new: "new" }]);
    expect(edited.name).toBe("log/today.md");
    // Atomic writes stage a sibling temp file; every one must be renamed away.
    expect(await fs.readdir(join(dir, "log"))).toEqual(["today.md"]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("searchNotes matches all keywords, ranks hits, skips non-notes", async () => {
    const dir = await makeDir();
    await writeNote(dir, "a.md", "# Alpha\nthe quick brown fox and the quick cat", {});
    await writeNote(dir, "b.md", "# Beta\nquick brown");
    await writeNote(dir, "c.txt", "unrelated words", {});
    await fs.writeFile(join(dir, "d.js"), "quick brown fox");
    const hits = await searchNotes(dir, "quick brown");
    expect(hits.map((h) => h.name).sort()).toEqual(["a.md", "b.md"]);
    expect(hits[0].score).toBeGreaterThan(hits[1].score); // a.md has more occurrences
    expect(hits[0].snippet).toContain("quick");
    const partial = await searchNotes(dir, "quick fox"); // b.md lacks "fox"
    expect(partial.map((h) => h.name)).toEqual(["a.md"]);
    expect(await searchNotes(dir, "missing word")).toEqual([]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
