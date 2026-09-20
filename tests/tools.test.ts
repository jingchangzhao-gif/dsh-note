// The dsh tool layer (src/note-tools.ts, src/memory-tools.ts): argument
// validation, zone/dir overrides and the model-facing render text. The lib
// functions behind them are covered by notes/memory/context tests; these tests
// pin the surface the model actually calls.

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { describe, expect, it } from "vitest";
import { addMemoryEntry } from "../src/memory";
import {
  memoryAddTool,
  memoryCompactTool,
  memoryRecallTool,
  memoryRemoveTool,
  memoryUpdateTool,
} from "../src/memory-tools";
import { readNoteFull, writeNote } from "../src/notes";
import {
  noteContextTool,
  noteEditTool,
  noteForgetTool,
  noteListTool,
  noteLinksTool,
  noteMapTool,
  noteRecallTool,
  noteRememberTool,
  noteSearchTool,
  noteStatsTool,
  noteWriteTool,
} from "../src/note-tools";

type Exec = Parameters<ToolDefinition["execute"]>[1];

/** Fake execution identity: only cwdOf(exec) is read by the tools. */
function ctx(cwd: string): Exec {
  return { agent: { session: { header: { cwd } } } } as unknown as Exec;
}

async function run<T>(
  tool: ToolDefinition,
  cwd: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return (await tool.execute(args, ctx(cwd))) as T;
}

/** The model-facing text a tool renders for one canonical value. */
function renderText(tool: ToolDefinition, args: Record<string, unknown>, value: unknown): string {
  const blocks = tool.output.render(args, value as never) as { type: string; text?: string }[];
  return blocks.map((block) => block.text ?? "").join("\n");
}

async function makeRoot(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "dsh-note-tools-"));
}

describe("note tools", () => {
  it("note_remember writes into ./notes under the session cwd", async () => {
    const root = await makeRoot();
    const first = await run<{ name: string; path: string }>(noteRememberTool, root, {
      name: "session.md",
      content: "first",
    });
    expect(first.name).toBe("session.md");
    await run(noteRememberTool, root, { name: "session.md", content: "second" });
    const text = await fs.readFile(join(root, "notes", "session.md"), "utf8");
    expect(text).toContain("first");
    expect(text).toContain("second");
    await expect(run(noteRememberTool, root, { content: "x" })).rejects.toThrow(/name is required/);
    await expect(run(noteRememberTool, root, { name: "s.md", content: "  " })).rejects.toThrow(
      /Content to remember/,
    );
    await fs.rm(root, { recursive: true, force: true });
  });

  it("note_recall returns the full, tail and compact views", async () => {
    const root = await makeRoot();
    await writeNote(join(root, "notes"), "long.md", "z".repeat(3000), {
      title: "Long",
      summary: "digest",
    });
    const full = await run<{ content: string; truncated: boolean }>(noteRecallTool, root, {
      name: "long.md",
    });
    expect(full.content).toContain("z".repeat(3000));
    expect(full.truncated).toBe(false);
    const tail = await run<{ content: string; truncated: boolean }>(noteRecallTool, root, {
      name: "long.md",
      tail: 50,
    });
    expect(tail.content.length).toBeLessThanOrEqual(51); // clamped, may keep the "…"
    expect(tail.truncated).toBe(true);
    const compact = await run<{ content: string; truncated: boolean }>(noteRecallTool, root, {
      name: "long.md",
      compact: true,
    });
    expect(compact.content.startsWith("summary: digest")).toBe(true);
    expect(compact.truncated).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("note_list hides archives in the memory zone but shows them in writing", async () => {
    const root = await makeRoot();
    await writeNote(join(root, "notes"), "draft.md", "body");
    await writeNote(join(root, "notes"), "old.archive.md", "body");
    await writeNote(join(root, "memory"), "kept.md", "body");
    await writeNote(join(root, "memory"), "typed.archive.md", "body", { type: "archive" });
    const writing = await run<{ notes: { name: string }[] }>(noteListTool, root, {
      zone: "writing",
    });
    expect(writing.notes.map((note) => note.name)).toEqual(["draft.md", "old.archive.md"]);
    const memory = await run<{ notes: { name: string }[] }>(noteListTool, root, { zone: "memory" });
    expect(memory.notes.map((note) => note.name)).toEqual(["kept.md"]);
    await expect(run(noteListTool, root, { zone: "bogus" })).rejects.toThrow(/zone must be/);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("note_write replaces the body and keeps untouched front matter", async () => {
    const root = await makeRoot();
    const created = await run<{ name: string; created: boolean }>(noteWriteTool, root, {
      name: "a.md",
      content: "one",
      title: "A",
      tags: "x",
    });
    expect(created).toMatchObject({ name: "a.md", created: true });
    const updated = await run<{ created: boolean }>(noteWriteTool, root, {
      name: "a.md",
      content: "two",
    });
    expect(updated.created).toBe(false);
    const full = await readNoteFull(join(root, "notes"), "a.md");
    expect(full.body).toBe("two");
    expect(full.meta.title).toBe("A");
    expect(full.meta.tags).toBe("x");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("note_edit replaces the first occurrence unless all is set", async () => {
    const root = await makeRoot();
    await writeNote(join(root, "notes"), "e.md", "foo foo foo");
    const one = await run<{ edits: number; changed: boolean }>(noteEditTool, root, {
      name: "e.md",
      old: "foo",
      new: "bar",
    });
    expect(one).toMatchObject({ edits: 1, changed: true });
    const rest = await run<{ edits: number }>(noteEditTool, root, {
      name: "e.md",
      old: "foo",
      new: "bar",
      all: true,
    });
    expect(rest.edits).toBe(2);
    const none = await run<{ changed: boolean; edits: number }>(noteEditTool, root, {
      name: "e.md",
      old: "absent",
      new: "x",
    });
    expect(none).toMatchObject({ changed: false, edits: 0 });
    await expect(run(noteEditTool, root, { name: "e.md", old: "" })).rejects.toThrow(/old text/);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("note_forget deletes the file and renders the outcome", async () => {
    const root = await makeRoot();
    await writeNote(join(root, "notes"), "gone.md", "hi");
    const removed = await run<{ removed: boolean }>(noteForgetTool, root, { name: "gone.md" });
    expect(removed.removed).toBe(true);
    expect(renderText(noteForgetTool, { name: "gone.md" }, removed)).toContain("removed: true");
    const again = await run<{ removed: boolean }>(noteForgetTool, root, { name: "gone.md" });
    expect(again.removed).toBe(false);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("note_search skips memory archives and can search both zones", async () => {
    const root = await makeRoot();
    await writeNote(join(root, "notes"), "writing.md", "shared token alpha");
    await writeNote(join(root, "memory"), "live.md", "shared token beta");
    await writeNote(join(root, "memory"), "dead.archive.md", "shared token gamma");
    const all = await run<{ hits: { name: string }[] }>(noteSearchTool, root, {
      query: "shared token",
      zone: "all",
    });
    expect(all.hits.map((hit) => hit.name).sort()).toEqual(["live.md", "writing.md"]);
    const memory = await run<{ hits: { name: string }[] }>(noteSearchTool, root, {
      query: "shared",
      zone: "memory",
    });
    expect(memory.hits.map((hit) => hit.name)).toEqual(["live.md"]);
    await expect(run(noteSearchTool, root, { query: "  " })).rejects.toThrow(/query is required/);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("note_context honours the zone overrides and the chars budget", async () => {
    const root = await makeRoot();
    const custom = join(root, "custom");
    const bank = join(root, "bank");
    // Long enough that its recent-tail part cannot fit a 500-char packet.
    await writeNote(custom, "wip.md", `${"x".repeat(2000)} tail marker pnpm note`);
    await addMemoryEntry(bank, "remembered pnpm decision");
    const args = {
      focus: "pnpm",
      notes: ["wip.md"],
      dir: custom,
      memoryDir: bank,
    };
    const result = await run<{ context: string; parts: number; chars: number }>(
      noteContextTool,
      root,
      args,
    );
    expect(result.parts).toBeGreaterThanOrEqual(3); // note tail + search hit + memory
    expect(result.context).toContain("tail marker pnpm note");
    expect(result.context).toContain("remembered pnpm decision");
    expect(renderText(noteContextTool, args, result)).toContain("[context parts:");
    const tight = await run<{ chars: number; truncated: boolean }>(noteContextTool, root, {
      ...args,
      chars: 500,
    });
    expect(tight.chars).toBeLessThanOrEqual(500);
    expect(tight.truncated).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("note_stats sizes a zone and renders the numbers", async () => {
    const root = await makeRoot();
    await addMemoryEntry(join(root, "memory"), "an entry", { name: "m.md" });
    const stats = await run<{
      zone: string;
      files: number;
      archives: number;
      entries: number;
      bytes: number;
      largestName: string;
    }>(noteStatsTool, root, { zone: "memory" });
    expect(stats).toMatchObject({ zone: "memory", files: 1, archives: 0, entries: 1 });
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.largestName).toBe("m.md");
    const text = renderText(noteStatsTool, { zone: "memory" }, stats);
    expect(text).toContain("bytes:");
    expect(text).toContain("largest: m.md");
    const empty = await run<{ files: number; largestName: string }>(noteStatsTool, root, {
      zone: "writing",
    });
    expect(empty).toMatchObject({ files: 0, largestName: "" });
    expect(renderText(noteStatsTool, { zone: "writing" }, empty)).not.toContain("largest:");
    await expect(run(noteStatsTool, root, { zone: "bogus" })).rejects.toThrow(/zone must be/);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("note_map outlines a zone and renders its entry headings", async () => {
    const root = await makeRoot();
    await addMemoryEntry(join(root, "memory"), "decision body", {
      name: "d.md",
      title: "use pnpm",
    });
    const map = await run<{
      zone: string;
      total: number;
      files: { name: string; entries: number; headings: string[] }[];
    }>(noteMapTool, root, { zone: "memory" });
    expect(map).toMatchObject({ zone: "memory", total: 1 });
    expect(map.files[0].entries).toBe(1);
    expect(map.files[0].headings[0]).toContain("use pnpm");
    const text = renderText(noteMapTool, { zone: "memory" }, map);
    expect(text).toContain("memory map: 1 file(s)");
    expect(text).toContain("use pnpm");
    await expect(run(noteMapTool, root, { zone: "bogus" })).rejects.toThrow(/zone must be/);

    // The same call carries the relationship summary, which also proves the
    // output schema accepts the link fields.
    await writeNote(join(root, "notes"), "hub.md", "See [a](a.md).");
    await writeNote(join(root, "notes"), "a.md", "Back to [[hub]].");
    await writeNote(join(root, "notes"), "b.md", "alone");
    const linked = await run<{ links: number; orphans: string[] }>(noteMapTool, root, {
      zone: "writing",
    });
    expect(linked).toMatchObject({ links: 2, orphans: ["b.md"] });
    const linkedText = renderText(noteMapTool, { zone: "writing" }, linked);
    expect(linkedText).toContain("links: 2");
    expect(linkedText).toContain("orphans: b.md");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("note_links follows links between notes", async () => {
    const root = await makeRoot();
    await writeNote(join(root, "notes"), "hub.md", "See [a](a.md).");
    await writeNote(join(root, "notes"), "a.md", "Back to [[hub]].");
    const zone = await run<{ files: number; links: number; orphans: string[] }>(
      noteLinksTool,
      root,
      {},
    );
    expect(zone).toMatchObject({ files: 2, links: 2, orphans: [] });
    expect("note" in zone).toBe(false); // absent, not undefined
    expect(renderText(noteLinksTool, {}, zone)).toContain("2 link(s)");
    const note = await run<{ note?: { name: string; out: string[]; back: string[] } }>(
      noteLinksTool,
      root,
      { name: "hub" },
    );
    expect(note.note).toMatchObject({ name: "hub.md", out: ["a.md"], back: ["a.md"] });
    await expect(run(noteLinksTool, root, { name: "ghost.md" })).rejects.toThrow(/Note not found/);
    await expect(run(noteLinksTool, root, { zone: "bogus" })).rejects.toThrow(/zone must be/);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("renders empty search and recall outcomes as plain text", async () => {
    const root = await makeRoot();
    const search = await run<{ hits: unknown[] }>(noteSearchTool, root, { query: "nothing here" });
    expect(renderText(noteSearchTool, { query: "nothing here" }, search)).toBe("No matches.");
    const recall = await run<{ content: string }>(memoryRecallTool, root, {});
    expect(renderText(memoryRecallTool, {}, recall)).toBe("(no memory matched)");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("note_context skips a named note that does not exist", async () => {
    const root = await makeRoot();
    await addMemoryEntry(join(root, "memory"), "still here");
    // defineTool validates args before execute, so only the missing-note path
    // is reachable here; the non-string filter inside execute is defensive.
    const result = await run<{ context: string }>(noteContextTool, root, {
      notes: ["ghost.md"],
    });
    expect(result.context).toContain("still here");
    // No `notes` argument at all: the empty-name list must still work.
    const withoutNames = await run<{ context: string }>(noteContextTool, root, {});
    expect(withoutNames.context).toContain("still here");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("note_search treats an unknown zone as all zones", async () => {
    const root = await makeRoot();
    await writeNote(join(root, "notes"), "w.md", "token here");
    const result = await run<{ zone: string; hits: unknown[] }>(noteSearchTool, root, {
      query: "token",
      zone: "bogus",
    });
    expect(result.zone).toBe("all");
    expect(result.hits).toHaveLength(1);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("renders each note tool outcome as model-facing text", async () => {
    const root = await makeRoot();
    const remembered = await run<{ name: string }>(noteRememberTool, root, {
      name: "s.md",
      content: "hello",
    });
    expect(renderText(noteRememberTool, {}, remembered)).toBe("Remembered in s.md");
    const wrote = await run<{ name: string; created: boolean }>(noteWriteTool, root, {
      name: "a.md",
      content: "one",
    });
    expect(renderText(noteWriteTool, {}, wrote)).toBe("Wrote a.md (created)");
    const edited = await run<{ edits: number; changed: boolean }>(noteEditTool, root, {
      name: "a.md",
      old: "one",
      new: "two",
    });
    expect(renderText(noteEditTool, {}, edited)).toBe(
      "Edited a.md: 1 replacement(s), changed: true",
    );
    const listed = await run<{ notes: { name: string }[] }>(noteListTool, root, {});
    expect(renderText(noteListTool, {}, listed)).toContain("Notes [writing] in");
    const recalled = await run<{ content: string; truncated: boolean }>(noteRecallTool, root, {
      name: "a.md",
      compact: true,
    });
    expect(renderText(noteRecallTool, {}, recalled)).toBe(recalled.content);
    const found = await run<{ hits: { name: string }[] }>(noteSearchTool, root, { query: "two" });
    const searchText = renderText(noteSearchTool, { query: "two" }, found);
    expect(searchText).toContain("[1] a.md"); // no title, so the name is used
    expect(searchText).toContain("two");
    await expect(run(noteWriteTool, root, { name: "b.md" })).rejects.toThrow(
      /Note content is required/,
    );
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe("memory tools", () => {
  it("memory_add writes the default bank file with tags and type", async () => {
    const root = await makeRoot();
    const added = await run<{ name: string }>(memoryAddTool, root, {
      content: "user prefers dark mode",
      tags: "prefs",
      type: "preference",
    });
    expect(added.name).toBe("memory.md");
    const note = await readNoteFull(join(root, "memory"), "memory.md");
    expect(note.meta.tags).toBe("prefs");
    expect(note.meta.type).toBe("preference");
    expect(note.body).toContain("user prefers dark mode");
    await expect(run(memoryAddTool, root, { content: " " })).rejects.toThrow(/Content to remember/);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("memory_recall maps its filters and returns an empty result when nothing matches", async () => {
    const root = await makeRoot();
    const bank = join(root, "memory");
    await addMemoryEntry(bank, "old pnpm decision", {
      name: "d.md",
      when: "2024-01-01T00:00:00.000Z",
      tags: "tooling",
    });
    await addMemoryEntry(bank, "new dark mode", {
      name: "d.md",
      when: "2024-06-01T00:00:00.000Z",
    });
    const recent = await run<{ content: string }>(memoryRecallTool, root, {
      newerThan: "2024-05-01",
    });
    expect(recent.content).toContain("dark mode");
    expect(recent.content).not.toContain("pnpm");
    const byTag = await run<{ content: string }>(memoryRecallTool, root, { tags: "tooling" });
    expect(byTag.content).toContain("pnpm");
    const none = await run<{ content: string }>(memoryRecallTool, root, { query: "no-such-topic" });
    expect(none.content).toBe("");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("memory_update requires something to change and reports real changes", async () => {
    const root = await makeRoot();
    await addMemoryEntry(join(root, "memory"), "seed entry", { name: "m.md" });
    const meta = await run<{ changed: boolean }>(memoryUpdateTool, root, {
      name: "m.md",
      meta: { summary: "digest" },
    });
    expect(meta.changed).toBe(true);
    const same = await run<{ changed: boolean }>(memoryUpdateTool, root, {
      name: "m.md",
      meta: { summary: "digest" },
    });
    expect(same.changed).toBe(false);
    const appended = await run<{ changed: boolean }>(memoryUpdateTool, root, {
      name: "m.md",
      content: "another entry",
    });
    expect(appended.changed).toBe(true);
    await expect(run(memoryUpdateTool, root, { name: "m.md" })).rejects.toThrow(
      /Nothing to update/,
    );
    await fs.rm(root, { recursive: true, force: true });
  });

  it("memory_compact archives by keep count and by date, and recalls skip archives", async () => {
    const root = await makeRoot();
    const bank = join(root, "memory");
    for (const [day, marker] of [
      ["2024-01-01", "oldest alpha"],
      ["2024-02-01", "middle beta"],
      ["2024-03-01", "newest gamma"],
    ]) {
      await addMemoryEntry(bank, marker, { name: "log.md", when: `${day}T00:00:00.000Z` });
    }
    const byKeep = await run<{ kept: number; archived: number; archive: string }>(
      memoryCompactTool,
      root,
      { name: "log.md", keep: 1 },
    );
    expect(byKeep).toMatchObject({ kept: 1, archived: 2, archive: "log.archive.md" });
    const recalled = await run<{ content: string }>(memoryRecallTool, root, {
      query: "middle beta",
    });
    expect(recalled.content).toBe("");
    const byDate = await run<{ archived: number; kept: number }>(memoryCompactTool, root, {
      name: "log.md",
      olderThan: "2024-04-01",
    });
    expect(byDate).toMatchObject({ archived: 1, kept: 0 });
    await fs.rm(root, { recursive: true, force: true });
  });

  it("memory_remove deletes matching entries and renders the count", async () => {
    const root = await makeRoot();
    const bank = join(root, "memory");
    await addMemoryEntry(bank, "keep this", { name: "m.md" });
    await addMemoryEntry(bank, "discard me", { name: "m.md" });
    await addMemoryEntry(bank, "discard me too", { name: "m.md" });
    const both = await run<{ removed: number }>(memoryRemoveTool, root, {
      name: "m.md",
      match: "discard",
    });
    expect(both.removed).toBe(2);
    expect(renderText(memoryRemoveTool, { match: "discard" }, both)).toContain("Removed 2 entries");
    const single = await run<{ removed: number }>(memoryRemoveTool, root, {
      name: "m.md",
      match: "keep",
    });
    expect(renderText(memoryRemoveTool, { match: "keep" }, single)).toContain("Removed 1 entry");
    await expect(run(memoryRemoveTool, root, { name: "m.md", match: "" })).rejects.toThrow(
      /match text/,
    );
    await fs.rm(root, { recursive: true, force: true });
  });

  it("renders each memory tool outcome as model-facing text", async () => {
    const root = await makeRoot();
    const added = await run<{ name: string }>(memoryAddTool, root, {
      content: "remember this",
      title: "a titled entry",
    });
    expect(renderText(memoryAddTool, {}, added)).toBe("Remembered in memory.md");
    const entry = await readNoteFull(join(root, "memory"), "memory.md");
    expect(entry.body).toContain("— a titled entry"); // title rides the heading
    const recalled = await run<{ content: string }>(memoryRecallTool, root, {});
    expect(renderText(memoryRecallTool, {}, recalled)).toBe(recalled.content);
    const updated = await run<{ name: string; changed: boolean }>(memoryUpdateTool, root, {
      name: "memory.md",
      meta: { summary: "digest" },
    });
    expect(renderText(memoryUpdateTool, {}, updated)).toBe("Updated memory.md (changed: true)");
    const digestRecall = await run<{ content: string }>(memoryRecallTool, root, {});
    expect(digestRecall.content).toContain("summary: digest"); // the stored digest leads
    const compacted = await run<{ kept: number; archived: number }>(memoryCompactTool, root, {
      name: "memory.md",
      keep: 1,
    });
    expect(renderText(memoryCompactTool, {}, compacted)).toBe(
      "Compacted memory.md: kept 1, archived 0",
    );
    await fs.rm(root, { recursive: true, force: true });
  });
});
