import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNoteFull } from "../src/notes";
import {
  addMemoryEntry,
  compactMemory,
  parseMemory,
  recallMemory,
  removeMemoryEntries,
  updateMemoryMeta,
} from "../src/memory";

async function makeDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "dsh-note-mem-"));
}

async function seed(dir: string): Promise<void> {
  const when = (day: string) => new Date(`${day}T00:00:00Z`).toISOString();
  await addMemoryEntry(dir, "decided pnpm for the project", {
    name: "decisions.md",
    when: when("2024-01-03"),
    type: "decision",
    tags: "tooling",
  });
  await addMemoryEntry(dir, "decided merge commits on paired PRs", {
    name: "decisions.md",
    when: when("2024-01-05"),
    type: "decision",
    tags: "tooling",
  });
  await addMemoryEntry(dir, "user prefers dark mode", {
    name: "memory.md",
    when: when("2024-02-01"),
    tags: "prefs",
  });
}

describe("memory bank", () => {
  it("addMemoryEntry writes timestamped entries with front matter", async () => {
    const dir = await makeDir();
    await seed(dir);
    const note = await readNoteFull(dir, "decisions.md");
    expect(note.meta.title).toBe("decisions");
    expect(note.meta.type).toBe("decision");
    expect(note.meta.tags).toBe("tooling");
    expect(note.body).toContain("## 2024-01-03T00:00:00.000Z");
    expect(note.body).toContain("decided pnpm for the project");
    const defaultNote = await readNoteFull(dir, "memory.md");
    expect(defaultNote.meta.title).toBe("memory");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("recall returns the recent tail first and respects the limit", async () => {
    const dir = await makeDir();
    await seed(dir);
    const all = await recallMemory(dir, { limit: 10, chars: 100_000 });
    expect(all.files).toBe(2);
    expect(all.content).toContain("dark mode");
    expect(all.content).toContain("merge commits");
    expect(all.truncated).toBe(false);
    const one = await recallMemory(dir, { limit: 1, chars: 100_000 });
    expect(one.files).toBe(1);
    expect(one.truncated).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("recall filters by query, tags, type, name and dates", async () => {
    const dir = await makeDir();
    await seed(dir);
    const byQuery = await recallMemory(dir, { query: "pnpm" });
    expect(byQuery.content).toContain("decided pnpm");
    expect(byQuery.content).not.toContain("dark mode");
    const byTags = await recallMemory(dir, { tags: "prefs" });
    expect(byTags.files).toBe(1);
    expect(byTags.content).toContain("dark mode");
    const byType = await recallMemory(dir, { type: "decision" });
    expect(byType.files).toBe(1);
    expect(byType.content).not.toContain("dark mode");
    const byName = await recallMemory(dir, { name: "memory.md" });
    expect(byName.files).toBe(1);
    expect(byName.content).not.toContain("pnpm");
    const since = await recallMemory(dir, { newerThan: "2024-01-20" });
    expect(since.content).not.toContain("pnpm");
    expect(since.content).toContain("dark mode");
    const before = await recallMemory(dir, { olderThan: "2024-01-04" });
    expect(before.content).toContain("decided pnpm");
    expect(before.content).not.toContain("merge commits");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("updateMemoryMeta merges a summary field into the front matter", async () => {
    const dir = await makeDir();
    await seed(dir);
    const result = await updateMemoryMeta(dir, "decisions.md", {
      summary: "digest of tooling choices",
    });
    expect(result.changed).toBe(true);
    const note = await readNoteFull(dir, "decisions.md");
    expect(note.meta.summary).toBe("digest of tooling choices");
    expect(note.meta.type).toBe("decision"); // untouched
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("compactMemory archives older entries and recall ignores archives", async () => {
    const dir = await makeDir();
    await seed(dir);
    const result = await compactMemory(dir, { name: "decisions.md", keep: 1 });
    expect(result.archived).toBe(1);
    expect(result.archive).toBe("decisions.archive.md");
    const note = await readNoteFull(dir, "decisions.md");
    expect(note.body).toContain("merge commits"); // newest entry stays
    expect(note.body).not.toContain("decided pnpm");
    const archive = await readNoteFull(dir, "decisions.archive.md");
    expect(archive.meta.type).toBe("archive");
    expect(archive.body).toContain("decided pnpm");
    const recall = await recallMemory(dir, { query: "pnpm", chars: 100_000 });
    expect(recall.content).toBe("");
    const noop = await compactMemory(dir, { name: "decisions.md", keep: 20 });
    expect(noop.archived).toBe(0);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("removeMemoryEntries deletes entries by literal match", async () => {
    const dir = await makeDir();
    await seed(dir);
    const result = await removeMemoryEntries(dir, "decisions.md", "merge");
    expect(result.removed).toBe(1);
    const note = await readNoteFull(dir, "decisions.md");
    expect(note.body).not.toContain("merge commits");
    expect(note.body).toContain("decided pnpm");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("parseMemory splits preamble and entries with timestamps", () => {
    const parsed = parseMemory(
      "preamble notes\n\n## 2024-01-01T00:00:00.000Z\none\n\n## 2024-01-02T00:00:00.000Z\ntwo",
    );
    expect(parsed.preamble).toBe("preamble notes");
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0].text).toContain("one");
    expect(parsed.entries[1].whenMs).toBe(Date.parse("2024-01-02T00:00:00.000Z"));
  });

  it("keeps markdown sub-headings inside one entry instead of splitting it", async () => {
    const dir = await makeDir();
    const content = "Here is the plan:\n\n## Step one\n\ndo X\n\n## Step two\n\ndo Y";
    await addMemoryEntry(dir, content, { name: "plan.md" });
    const note = await readNoteFull(dir, "plan.md");
    const parsed = parseMemory(note.body);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].text).toContain("## Step one");
    expect(parsed.entries[0].text).toContain("do Y");
    const recalled = await recallMemory(dir, { name: "plan.md" });
    expect(recalled.content).toContain("Here is the plan:");
    expect(recalled.content).toContain("do X");
    // Compaction must not archive content that belongs to the surviving entry.
    await compactMemory(dir, { name: "plan.md", keep: 1 });
    const after = await recallMemory(dir, { name: "plan.md" });
    expect(after.content).toContain("do X");
    expect(after.content).toContain("do Y");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("applies tags/type to a memory file that already exists", async () => {
    const dir = await makeDir();
    await addMemoryEntry(dir, "first entry", { name: "e.md" });
    await addMemoryEntry(dir, "second entry", {
      name: "e.md",
      tags: "alpha, beta",
      type: "decision",
    });
    const note = await readNoteFull(dir, "e.md");
    expect(note.meta.tags).toBe("alpha, beta");
    expect(note.meta.type).toBe("decision");
    const recalled = await recallMemory(dir, { name: "e.md", tags: "beta" });
    expect(recalled.content).toContain("second entry");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("matches tags case-insensitively without rewriting their spelling", async () => {
    const dir = await makeDir();
    await addMemoryEntry(dir, "casing test", { name: "c.md", tags: "Alpha" });
    const recalled = await recallMemory(dir, { name: "c.md", tags: "alpha" });
    expect(recalled.content).toContain("casing test");
    const note = await readNoteFull(dir, "c.md");
    expect(note.meta.tags).toBe("Alpha");
    await fs.rm(dir, { recursive: true, force: true });
  });
});
