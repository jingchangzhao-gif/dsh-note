import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendNote, readNote, listNotes, deleteNote, resolveMemoryDir } from "../src/notes";

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

  it("deleteNote removes a file and reports false when absent", async () => {
    const dir = await makeDir();
    await appendNote(dir, "gone.md", "hi");
    expect(await deleteNote(dir, "gone.md")).toBe(true);
    expect(await deleteNote(dir, "gone.md")).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("resolveMemoryDir defaults to ./notes under cwd", () => {
    expect(resolveMemoryDir("/w", undefined)).toBe("/w/notes");
    expect(resolveMemoryDir("/w", "/abs/dir")).toBe("/abs/dir");
  });
});
