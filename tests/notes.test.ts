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
