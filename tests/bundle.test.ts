import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportZone, importZone } from "../src/bundle";
import { addMemoryEntry, compactMemory } from "../src/memory";
import { appendNote, readNoteFull } from "../src/notes";

async function makeDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "dsh-note-bundle-"));
}

describe("zone bundles", () => {
  it("round-trips a zone, archives and nested files included", async () => {
    const root = await makeDir();
    const source = join(root, "source");
    const target = join(root, "target");
    await appendNote(source, "log/today.md", "nested body");
    await addMemoryEntry(source, "first entry", { name: "decisions.md" });
    await addMemoryEntry(source, "second entry", { name: "decisions.md" });
    await compactMemory(source, { name: "decisions.md", keep: 1 });

    const file = join(root, "bundle.json");
    const exported = await exportZone(source, file);
    expect(exported.files).toBe(3); // nested note + live bank file + its archive
    expect(exported.bytes).toBeGreaterThan(0);

    const imported = await importZone(target, file);
    expect(imported).toMatchObject({ files: 3, skipped: [] });
    expect((await readNoteFull(target, "log/today.md")).body).toContain("nested body");
    expect((await readNoteFull(target, "decisions.archive.md")).body).toContain("first entry");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("never overwrites an existing note unless told to", async () => {
    const root = await makeDir();
    const source = join(root, "source");
    const target = join(root, "target");
    await appendNote(source, "a.md", "snapshot body");
    const file = join(root, "bundle.json");
    await exportZone(source, file);
    await appendNote(target, "a.md", "newer local body");

    const protectedRun = await importZone(target, file);
    expect(protectedRun).toMatchObject({ files: 0, skipped: ["a.md"] });
    expect((await readNoteFull(target, "a.md")).body).toContain("newer local body");

    const forced = await importZone(target, file, { overwrite: true });
    expect(forced).toMatchObject({ files: 1, skipped: [] });
    expect((await readNoteFull(target, "a.md")).body).toContain("snapshot body");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("refuses bundles it cannot trust", async () => {
    const root = await makeDir();
    const zone = join(root, "zone");
    await expect(importZone(zone, join(root, "missing.json"))).rejects.toThrow(/not found/i);

    const badJson = join(root, "bad.json");
    await fs.writeFile(badJson, "not json", "utf8");
    await expect(importZone(zone, badJson)).rejects.toThrow(/invalid JSON/);

    const wrongVersion = join(root, "v9.json");
    await fs.writeFile(wrongVersion, JSON.stringify({ version: 9, files: [] }), "utf8");
    await expect(importZone(zone, wrongVersion)).rejects.toThrow(/Unsupported bundle format/);

    const badEntry = join(root, "entry.json");
    await fs.writeFile(
      badEntry,
      JSON.stringify({ version: 1, files: [{ name: 7, content: "x" }] }),
      "utf8",
    );
    await expect(importZone(zone, badEntry)).rejects.toThrow(/string name and content/);

    const escaping = join(root, "escape.json");
    await fs.writeFile(
      escaping,
      JSON.stringify({ version: 1, files: [{ name: "../evil.md", content: "x" }] }),
      "utf8",
    );
    await expect(importZone(zone, escaping)).rejects.toThrow(/escapes the notes directory/);
    await fs.rm(root, { recursive: true, force: true });
  });
});
