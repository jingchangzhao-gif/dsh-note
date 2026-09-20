import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addMemoryEntry, compactMemory } from "../src/memory";
import { appendNote, writeNote } from "../src/notes";
import { renderMermaidMap, renderZoneMap, zoneMap, zoneStats } from "../src/stats";

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

  it("sizes a zone that does not exist yet without creating it", async () => {
    const root = await makeDir();
    const zone = join(root, "memory");
    const stats = await zoneStats(zone);
    expect(stats).toMatchObject({ files: 0, archives: 0, entries: 0, bytes: 0, largest: null });
    await expect(fs.stat(zone)).rejects.toThrow();
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("zone map", () => {
  it("lists files with their newest entry headings, dates shortened", async () => {
    const dir = await makeDir();
    for (const [when, title] of [
      ["2024-01-01T00:00:00.000Z", "oldest"],
      ["2024-02-01T00:00:00.000Z", "middle"],
      ["2024-03-01T00:00:00.000Z", "newest"],
    ] as const) {
      await addMemoryEntry(dir, `${title} body`, { name: "log.md", title, when });
    }
    const map = await zoneMap(dir);
    expect(map).toMatchObject({ total: 1, omitted: 0, truncated: false });
    expect(map.files[0].entries).toBe(3);
    expect(map.files[0].headings[0]).toContain("2024-03-01"); // newest first
    expect(map.files[0].headings[0]).toContain("newest");
    expect(map.files[0].headings[0]).not.toContain("T00:00:00"); // stamp noise dropped
    expect(map.files[0].headings).toHaveLength(3);
    expect(renderZoneMap(map, "memory")).toContain("memory map: 1 file(s)");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("caps headings per file, then trims to fit the budget", async () => {
    const dir = await makeDir();
    for (let day = 1; day <= 6; day += 1) {
      await addMemoryEntry(dir, `body ${day}`, {
        name: "log.md",
        title: `entry ${day}`,
        when: `2024-01-0${day}T00:00:00.000Z`,
      });
    }
    const capped = await zoneMap(dir, { chars: 20_000 });
    expect(capped.files[0].headings).toHaveLength(5); // newest five, by design
    expect(capped.files[0].headings[0]).toContain("entry 6");
    expect(capped.truncated).toBe(false); // the cap is not budget pressure

    // Long headings in the same budget: the line fits, its headings do not.
    const long = await makeDir();
    for (let day = 1; day <= 3; day += 1) {
      await addMemoryEntry(long, `body ${day}`, {
        name: "log.md",
        title: `a very long entry title ${"t".repeat(80)}`,
        when: `2024-02-0${day}T00:00:00.000Z`,
      });
    }
    const squeezed = await zoneMap(long, { chars: 200 });
    expect(squeezed.truncated).toBe(true);
    expect(squeezed.files).toHaveLength(1);
    expect(squeezed.files[0].headings.length).toBeLessThan(5);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(long, { recursive: true, force: true });
  });

  it("omits whole files when the budget runs out", async () => {
    const dir = await makeDir();
    for (let index = 0; index < 6; index += 1) {
      await appendNote(dir, `note-with-a-rather-long-name-${index}.md`, "x".repeat(50));
    }
    const tight = await zoneMap(dir, { chars: 200 });
    expect(tight.total).toBe(6);
    expect(tight.truncated).toBe(true);
    expect(tight.omitted).toBeGreaterThan(0);
    expect(tight.files.length + tight.omitted).toBe(6); // every file accounted for
    expect(renderZoneMap(tight, "writing")).toContain("more file(s) not shown");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("hides archives unless they are asked for, and counts writing files by bytes", async () => {
    const dir = await makeDir();
    await appendNote(dir, "live.md", "live body");
    await appendNote(dir, "old.archive.md", "archived body");
    const hidden = await zoneMap(dir);
    expect(hidden.files.map((file) => file.name)).toEqual(["live.md"]);
    expect(hidden.total).toBe(1);
    expect(hidden.files[0].headings).toEqual([]); // writing notes carry no entries
    const shown = await zoneMap(dir, { includeArchives: true });
    expect(shown.files.map((file) => file.name)).toEqual(["live.md", "old.archive.md"]);
    expect(renderZoneMap(shown, "writing")).toMatch(/^- live\.md \(\d+ bytes\)$/m);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("carries the link structure into the map, and stays quiet without links", async () => {
    const dir = await makeDir();
    await writeNote(dir, "hub.md", "See [a](a.md) and [gone](gone.md).");
    await writeNote(dir, "a.md", "Back to [[hub]].");
    await writeNote(dir, "b.md", "alone");
    const map = await zoneMap(dir);
    expect(map).toMatchObject({ links: 2, broken: ["gone.md"], orphans: ["b.md"] });
    const text = renderZoneMap(map, "writing");
    expect(text).toContain("links: 2 (1 broken)");
    expect(text).toContain("orphans: b.md");

    const quiet = await makeDir();
    await writeNote(quiet, "x.md", "no links");
    expect(renderZoneMap(await zoneMap(quiet), "memory")).not.toContain("links:");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(quiet, { recursive: true, force: true });
  });

  it("lists five orphan names and counts the rest", async () => {
    const dir = await makeDir();
    await writeNote(dir, "hub.md", "See [a](a.md).");
    await writeNote(dir, "a.md", "Back to [[hub]].");
    for (let index = 0; index < 6; index += 1) {
      await writeNote(dir, `orphan-${index}.md`, "no links");
    }
    const text = renderZoneMap(await zoneMap(dir), "writing");
    expect(text).toMatch(
      /orphans: orphan-0\.md, orphan-1\.md, orphan-2\.md, orphan-3\.md, orphan-4\.md \(\+1\)/,
    );
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("renders the same outline as a sanitized Mermaid mind map", async () => {
    const dir = await makeDir();
    await addMemoryEntry(dir, "body", {
      name: "d.md",
      title: 'use "pnpm"',
      when: "2024-02-05T10:30:00.000Z",
    });
    await addMemoryEntry(dir, "long body", { name: "long.md", title: "t".repeat(100) });
    const mermaid = renderMermaidMap(await zoneMap(dir), "memory");
    expect(mermaid.startsWith('```mermaid\nmindmap\n  root["memory"]')).toBe(true);
    expect(mermaid.endsWith("```")).toBe(true);
    expect(mermaid).toContain("n1[\"d.md — use 'pnpm' (1 entry,"); // quotes neutralized
    expect(mermaid).toContain("2024-02-05 — use 'pnpm'"); // date shortened, same label
    expect(mermaid).not.toContain('"pnpm"');
    const longLabel = mermaid.split("\n").find((line) => line.includes("long.md"));
    expect(longLabel).toContain("…");
    expect(longLabel?.length).toBeLessThan(90); // capped at 60 chars inside ["…"]

    const empty = renderMermaidMap(
      {
        dir,
        files: [],
        total: 0,
        omitted: 2,
        truncated: true,
        links: 0,
        broken: [],
        orphans: [],
      },
      "writing",
    );
    expect(empty).toContain('more["… 2 more file(s) not shown"]');
    await fs.rm(dir, { recursive: true, force: true });
  });
});
