import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listNotes, readNote, writeNote } from "../src/notes";
import { renameNote } from "../src/rename";

async function makeDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "dsh-note-rename-"));
}

describe("rename with link rewriting", () => {
  it("moves the note and rewrites every link that resolved to it", async () => {
    const dir = await makeDir();
    await writeNote(dir, "decisions.md", "# Decisions\n\nbody");
    await writeNote(dir, "hub.md", 'See [[decisions|the ADR]] and [x](decisions.md#top "t").');
    await writeNote(dir, "other.md", "Also [[decisions#merges]].", { title: "Other" });

    const result = await renameNote(dir, "decisions", "log/choice.md");
    expect(result).toMatchObject({
      from: "decisions.md",
      to: "log/choice.md",
      moved: true,
      dryRun: false,
      links: 3,
    });
    expect(result.rewritten.sort()).toEqual(["hub.md", "other.md"]);
    expect(await readNote(dir, "hub.md")).toBe(
      'See [[log/choice|the ADR]] and [x](log/choice.md#top "t").\n',
    );
    const other = await readNote(dir, "other.md");
    expect(other).toContain("Also [[log/choice#merges]].");
    expect(other).toContain("title: Other"); // front matter survives the rewrite
    expect((await listNotes(dir)).map((note) => note.name)).toEqual([
      "hub.md",
      "log/choice.md",
      "other.md",
    ]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reports a dry run without touching anything", async () => {
    const dir = await makeDir();
    await writeNote(dir, "a.md", "body");
    await writeNote(dir, "hub.md", "See [[a]].");
    const plan = await renameNote(dir, "a.md", "b.md", { dryRun: true });
    expect(plan).toMatchObject({
      dryRun: true,
      moved: false,
      to: "b.md",
      links: 1,
      rewritten: ["hub.md"],
    });
    expect((await listNotes(dir)).map((note) => note.name)).toEqual(["a.md", "hub.md"]);
    expect(await readNote(dir, "hub.md")).toBe("See [[a]].\n"); // untouched
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("refuses an existing name and a note that is not there", async () => {
    const dir = await makeDir();
    await writeNote(dir, "a.md", "body");
    await writeNote(dir, "b.md", "body");
    await expect(renameNote(dir, "a.md", "b.md")).rejects.toThrow(/already exists/);
    await expect(renameNote(dir, "ghost.md", "c.md")).rejects.toThrow(/Note not found/);
    expect((await listNotes(dir)).map((note) => note.name)).toEqual(["a.md", "b.md"]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("renames by alias, appends the extension, and updates alias links", async () => {
    const dir = await makeDir();
    await writeNote(dir, "decisions.md", "body", { aliases: "adr" });
    await writeNote(dir, "hub.md", "See [[adr]].");
    const result = await renameNote(dir, "adr", "choice"); // extension added for us
    expect(result).toMatchObject({ from: "decisions.md", to: "choice.md", links: 1 });
    expect(await readNote(dir, "hub.md")).toBe("See [[choice]].\n");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("updates the renamed note's own self-links and leaves images alone", async () => {
    const dir = await makeDir();
    await writeNote(dir, "note.md", "Self [[note]] and image ![x](note.png).");
    const result = await renameNote(dir, "note.md", "renamed.md");
    expect(result.links).toBe(1);
    expect(await readNote(dir, "renamed.md")).toBe("Self [[renamed]] and image ![x](note.png).\n");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("treats a rename to the same name as a no-op", async () => {
    const dir = await makeDir();
    await writeNote(dir, "a.md", "body");
    await writeNote(dir, "hub.md", "See [[a]].");
    const result = await renameNote(dir, "a.md", "a.md");
    expect(result).toMatchObject({ moved: false, dryRun: false, links: 0, rewritten: [] });
    expect(await readNote(dir, "hub.md")).toBe("See [[a]].\n");
    await fs.rm(dir, { recursive: true, force: true });
  });
});
