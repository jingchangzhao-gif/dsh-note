import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addMemoryEntry, compactMemory } from "../src/memory";
import { writeNote } from "../src/notes";
import { zoneStats } from "../src/stats";

async function makeDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "dsh-note-stats-"));
}

describe("zone stats", () => {
  it("counts files, bytes and the largest file of a writing zone", async () => {
    const dir = await makeDir();
    await writeNote(dir, "a.md", "small body");
    await writeNote(dir, "b.md", "x".repeat(500));
    const stats = await zoneStats(dir);
    expect(stats).toMatchObject({ files: 2, archives: 0, entries: 0 });
    expect(stats.bytes).toBeGreaterThan(500);
    expect(stats.largest?.name).toBe("b.md");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("counts memory entries and archives separately", async () => {
    const dir = await makeDir();
    for (const day of ["2024-01-01", "2024-02-01", "2024-03-01"]) {
      await addMemoryEntry(dir, `entry ${day}`, { name: "log.md", when: `${day}T00:00:00.000Z` });
    }
    const before = await zoneStats(dir);
    expect(before).toMatchObject({ files: 1, archives: 0, entries: 3 });
    expect(before.largest?.name).toBe("log.md");
    await compactMemory(dir, { name: "log.md", keep: 1 });
    const after = await zoneStats(dir);
    expect(after).toMatchObject({ files: 1, archives: 1, entries: 1 });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reports an empty zone without inventing a largest file", async () => {
    const dir = await makeDir();
    const stats = await zoneStats(dir);
    expect(stats).toMatchObject({ files: 0, archives: 0, entries: 0, bytes: 0, largest: null });
    await fs.rm(dir, { recursive: true, force: true });
  });
});
