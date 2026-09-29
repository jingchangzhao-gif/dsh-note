import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listNotes, writeNote } from "../src/notes";
import { filterNotes } from "../src/query";

async function seeded(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "dsh-note-query-"));
  await writeNote(dir, "old.md", "old", { tags: "Work, archive-me", type: "plan" });
  await writeNote(dir, "mid.md", "mid", { tags: "home" });
  await writeNote(dir, "new.md", "new", { tags: "work", type: "log" });
  await writeNote(dir, "plain.md", "no front matter");
  // Modification times are what "changed since" means: an edit in another
  // editor moves the file's mtime but not dsh-note's `updated` field.
  const at = (day: string) => new Date(`${day}T00:00:00Z`);
  await fs.utimes(join(dir, "old.md"), at("2024-01-01"), at("2024-01-01"));
  await fs.utimes(join(dir, "mid.md"), at("2024-02-01"), at("2024-02-01"));
  await fs.utimes(join(dir, "new.md"), at("2024-03-01"), at("2024-03-01"));
  await fs.utimes(join(dir, "plain.md"), at("2023-06-01"), at("2023-06-01"));
  return dir;
}

describe("note filters", () => {
  it("returns the listing unchanged, and unstat'ed, without filters", async () => {
    const dir = await seeded();
    const notes = await listNotes(dir);
    const out = await filterNotes(notes);
    expect(out.map((note) => note.name)).toEqual(["mid.md", "new.md", "old.md", "plain.md"]);
    expect(out.every((note) => note.modified === undefined)).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("filters by any tag (case-insensitive) and by exact type", async () => {
    const dir = await seeded();
    const notes = await listNotes(dir);
    const names = async (filter: Parameters<typeof filterNotes>[1]) =>
      (await filterNotes(notes, filter)).map((note) => note.name);
    expect(await names({ tags: "WORK" })).toEqual(["new.md", "old.md"]);
    expect(await names({ tags: "home, archive-me" })).toEqual(["mid.md", "old.md"]);
    expect(await names({ type: "log" })).toEqual(["new.md"]);
    expect(await names({ tags: "work", type: "plan" })).toEqual(["old.md"]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("lists what changed since a date, newest first, with its modified time", async () => {
    const dir = await seeded();
    const notes = await listNotes(dir);
    const recent = await filterNotes(notes, { since: "2024-01-15", sort: "recent" });
    expect(recent.map((note) => [note.name, note.modified])).toEqual([
      ["new.md", "2024-03-01T00:00:00.000Z"],
      ["mid.md", "2024-02-01T00:00:00.000Z"],
    ]);
    const top = await filterNotes(notes, { sort: "recent", limit: 2 });
    expect(top.map((note) => note.name)).toEqual(["new.md", "mid.md"]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("refuses a date or sort it cannot use instead of ignoring it", async () => {
    const dir = await seeded();
    const notes = await listNotes(dir);
    await expect(filterNotes(notes, { since: "last week" })).rejects.toThrow(
      /since must be a parseable date, got: last week/,
    );
    await expect(filterNotes(notes, { sort: "size" as "name" })).rejects.toThrow(
      /sort must be "name" or "recent"/,
    );
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("skips a note deleted between the listing and the filter", async () => {
    const dir = await seeded();
    const notes = await listNotes(dir);
    await fs.rm(join(dir, "new.md"));
    const recent = await filterNotes(notes, { sort: "recent" });
    expect(recent.map((note) => note.name)).toEqual(["mid.md", "old.md", "plain.md"]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
