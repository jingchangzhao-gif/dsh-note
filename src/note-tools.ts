// The dsh tools for local notes (writing zone, ./notes by default) plus the
// generic ones: list, free keyword search across zones, forget, and the
// context assembler that feeds the model the small relevant chunk before it
// thinks. Every tool here is FREE file work — no model calls happen inside.

import { defineTool } from "@deepseek-ai/dsh-tools";
import { buildContext } from "./context";
import {
  appendNote,
  deleteNote,
  editNote,
  editSection,
  listNotes,
  readNoteFull,
  searchNotes,
  trashNote,
  writeNote,
  zoneRoot,
} from "./notes";
import type { Zone } from "./notes";
import { linkReport, renderLinkReport } from "./links";
import type { LinkReport } from "./links";
import { filterNotes } from "./query";
import type { FilteredNote, NoteFilter } from "./query";
import { renameNote } from "./rename";
import { sectionMode } from "./sections";
import { renderTagCounts, renderZoneMap, STATS_TAGS_SHOWN, zoneMap, zoneStats } from "./stats";
import type { ZoneMap } from "./stats";
import { booleanOf, cwdOf, number, text, type ExecShape } from "./tool-util";
import { forgetText } from "./view";
import { clampSearchLimit, recallView, visibleOnly } from "./view";

function zoneDir(zone: Zone, cwd: string | undefined, dir?: string): string {
  return zoneRoot(zone, cwd, dir);
}

function zoneArg(value: unknown, fallback: Zone): Zone {
  if (value === "writing" || value === "memory") return value;
  if (value === undefined) return fallback;
  throw new Error('zone must be "writing" or "memory".');
}

const noteSummarySchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    path: { type: "string" },
    title: { type: "string" },
    type: { type: "string" },
    tags: { type: "string" },
    updated: { type: "string" },
    modified: { type: "string" },
  },
  additionalProperties: false,
} as const;

interface NoteSummary {
  name: string;
  path: string;
  title?: string;
  type?: string;
  tags?: string;
  updated?: string;
  /** file modification time, only when a recency filter or sort was used */
  modified?: string;
}

function toSummary(file: FilteredNote): NoteSummary {
  const out: NoteSummary = { name: file.name, path: file.path };
  if (file.title) out.title = file.title;
  if (file.meta.type) out.type = file.meta.type;
  if (file.meta.tags) out.tags = file.meta.tags;
  if (file.meta.updated) out.updated = file.meta.updated;
  if (file.modified) out.modified = file.modified;
  return out;
}

export const noteRememberTool = defineTool({
  name: "note_remember",
  description:
    "Append a memory snippet to a named note in the writing zone (creating it if missing). Use to persist context instead of re-sending it every turn. New content goes below the existing body; front matter is kept in place.",
  parameters: {
    name: { type: "string", description: "Note filename, e.g. session.md." },
    content: { type: "string", description: "Markdown/text to remember." },
    dir: {
      type: "string",
      description: "Optional writing directory override (./notes by default).",
    },
  },
  output: {
    schema: {
      type: "object",
      properties: { name: { type: "string" }, path: { type: "string" } },
      additionalProperties: false,
    },
    render: (_args, value) => [
      { type: "text", text: `Remembered in ${(value as { name?: string }).name ?? "note"}` },
    ],
  },
  async execute(args, exec) {
    const { name, content, dir } = (args ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) throw new Error("A note name is required.");
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Content to remember is required.");
    }
    const zone = zoneDir("writing", cwdOf(exec as ExecShape | undefined), text(dir));
    return appendNote(zone, name.trim(), content);
  },
});

export const noteRecallTool = defineTool({
  name: "note_recall",
  description:
    "Read a note back (front matter included). Use tail to pull only the most recent characters. Use compact to get a small view — the summary front matter field plus the recent tail — when the note is long. For a long structured note, ask for outline first (its headings with section sizes), then read just the section you need by its heading. Pick at most one of tail, compact, section, outline. Keeps context and token cost small.",
  parameters: {
    name: { type: "string", description: "Note filename, e.g. session.md." },
    tail: { type: "number", description: "Optional: return only the last N characters." },
    compact: {
      type: "boolean",
      description:
        "Optional: small view (summary field + recent ~800 chars) instead of the full note.",
    },
    section: {
      type: "string",
      description:
        'Optional: return only the section under this heading (e.g. "Setup"), subsections included.',
    },
    outline: {
      type: "boolean",
      description: "Optional: return only the note's headings, each with its section size.",
    },
    dir: {
      type: "string",
      description: "Optional writing directory override (./notes by default).",
    },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        content: { type: "string" },
        truncated: { type: "boolean" },
      },
      additionalProperties: false,
    },
    render: (_args, value) => [
      { type: "text", text: (value as { content?: string }).content ?? "" },
    ],
  },
  async execute(args, exec) {
    const { name, tail, compact, section, outline, dir } = (args ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) throw new Error("A note name is required.");
    const zone = zoneDir("writing", cwdOf(exec as ExecShape | undefined), text(dir));
    const full = await readNoteFull(zone, name.trim());
    const view = recallView(full, {
      tail: tail == null ? undefined : number(tail),
      compact: booleanOf(compact),
      section: text(section),
      outline: booleanOf(outline),
    });
    return { name: full.name, content: view.content, truncated: view.truncated };
  },
});

export const noteListTool = defineTool({
  name: "note_list",
  description:
    "List the local notes of a zone (writing ./notes by default, or the long-term memory ./memory zone). Archive files (type archive) are hidden from the memory listing. Narrow it for free: tags (any of), type, since (modified at/after a date), sort recent (newest first) and limit — e.g. what changed since the last session.",
  parameters: {
    zone: { type: "string", description: '"writing" (default) or "memory".' },
    tags: { type: "string", description: "Comma separated; notes carrying any of these tags." },
    type: { type: "string", description: "Only notes whose front matter type equals this." },
    since: { type: "string", description: "Only notes modified at/after this date (ISO)." },
    sort: { type: "string", description: '"name" (default) or "recent" (newest first).' },
    limit: { type: "number", description: "Max notes to return (1-1000)." },
    dir: { type: "string", description: "Optional directory override for the selected zone." },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        zone: { type: "string" },
        dir: { type: "string" },
        notes: { type: "array", items: noteSummarySchema },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { zone?: string; dir?: string; notes?: NoteSummary[] };
      const lines = [`Notes [${v.zone ?? "writing"}] in ${v.dir ?? "?"}:`];
      for (const note of v.notes ?? []) {
        const modified = note.modified ? ` (modified ${note.modified})` : "";
        lines.push(`- ${note.name}${note.title ? ` — ${note.title}` : ""}${modified}`);
      }
      return [{ type: "text", text: lines.join("\n") }];
    },
  },
  async execute(args, exec) {
    const {
      zone: zoneValue,
      tags,
      type,
      since,
      sort,
      limit,
      dir,
    } = (args ?? {}) as Record<string, unknown>;
    const zone = zoneArg(zoneValue, "writing");
    const root = zoneDir(zone, cwdOf(exec as ExecShape | undefined), text(dir));
    const all = await listNotes(root);
    // The memory zone hides archives; the writing zone shows everything.
    const filtered = await filterNotes(visibleOnly(all, zone !== "memory"), {
      tags: text(tags),
      type: text(type),
      since: text(since),
      sort: text(sort) as NoteFilter["sort"],
      limit: number(limit),
    });
    return { zone, dir: root, notes: filtered.map(toSummary) };
  },
});

export const noteWriteTool = defineTool({
  name: "note_write",
  description:
    "Fully replace a note's body in the writing zone (creating it when missing) — for updates, rewrites and reordering, not just appends. Front matter fields given here merge in; existing fields are preserved; updated is maintained. Set createOnly when writing a new note, so an existing one of the same name is never overwritten.",
  parameters: {
    name: { type: "string", description: "Note filename, e.g. article.md." },
    content: { type: "string", description: "The new full body (markdown)." },
    title: { type: "string", description: "Optional front matter title." },
    tags: { type: "string", description: "Optional comma separated front matter tags." },
    type: { type: "string", description: "Optional front matter type (e.g. article)." },
    createOnly: {
      type: "boolean",
      description: "Optional: refuse instead of replacing a note that already exists.",
    },
    dir: {
      type: "string",
      description: "Optional writing directory override (./notes by default).",
    },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        path: { type: "string" },
        created: { type: "boolean" },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { name?: string; created?: boolean };
      return [
        { type: "text", text: `Wrote ${v.name ?? "note"} (${v.created ? "created" : "updated"})` },
      ];
    },
  },
  async execute(args, exec) {
    const { name, content, title, tags, type, createOnly, dir } = (args ?? {}) as Record<
      string,
      unknown
    >;
    if (typeof name !== "string" || !name.trim()) throw new Error("A note name is required.");
    if (typeof content !== "string") throw new Error("Note content is required.");
    const patch: Record<string, string> = {};
    if (typeof title === "string" && title.trim()) patch.title = title.trim();
    if (typeof tags === "string" && tags.trim()) patch.tags = tags.trim();
    if (typeof type === "string" && type.trim()) patch.type = type.trim();
    const zone = zoneDir("writing", cwdOf(exec as ExecShape | undefined), text(dir));
    const result = await writeNote(zone, name.trim(), content, patch, {
      createOnly: booleanOf(createOnly),
    });
    return { name: result.name, path: result.path, created: result.created };
  },
});

export const noteEditTool = defineTool({
  name: "note_edit",
  description:
    "Edit a note's body in place (front matter is never matched). Literal mode: old → new; without all=true only the first occurrence is replaced, and new=\"\" deletes the match. Section mode: give section (a heading) instead of old, and new becomes that section's content — mode replace (default, subsections included), append (end of the section) or prepend (under the heading) — so a part can be rewritten without quoting its old text. Use for targeted updates after the model decided what to change.",
  parameters: {
    name: { type: "string", description: "Note filename, e.g. session.md." },
    old: { type: "string", description: "Literal text to find (body only)." },
    new: {
      type: "string",
      description: "Replacement text (default empty = delete), or the section content.",
    },
    all: { type: "boolean", description: "Replace every occurrence instead of just the first." },
    section: {
      type: "string",
      description: 'Section mode: the heading to edit under, e.g. "Setup" (instead of old).',
    },
    mode: {
      type: "string",
      description: 'Section mode: "replace" (default), "append" or "prepend".',
    },
    dir: {
      type: "string",
      description: "Optional writing directory override (./notes by default).",
    },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        changed: { type: "boolean" },
        edits: { type: "number" },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { name?: string; changed?: boolean; edits?: number };
      return [
        {
          type: "text",
          text: `Edited ${v.name ?? "note"}: ${v.edits ?? 0} replacement(s), changed: ${v.changed ?? false}`,
        },
      ];
    },
  },
  async execute(args, exec) {
    const {
      name,
      old,
      new: replacement,
      all,
      section,
      mode,
      dir,
    } = (args ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) throw new Error("A note name is required.");
    const zone = zoneDir("writing", cwdOf(exec as ExecShape | undefined), text(dir));
    if (typeof section === "string") {
      if (old !== undefined || all !== undefined) {
        throw new Error("Give either old (literal edit) or section, not both.");
      }
      const result = await editSection(
        zone,
        name.trim(),
        section,
        typeof replacement === "string" ? replacement : "",
        sectionMode(mode),
      );
      return { name: result.name, changed: result.changed, edits: result.changed ? 1 : 0 };
    }
    if (typeof old !== "string" || old === "") throw new Error("old text to find is required.");
    const result = await editNote(zone, name.trim(), [
      { old, new: typeof replacement === "string" ? replacement : "", all: booleanOf(all) },
    ]);
    return { name: result.name, changed: result.changed, edits: result.edits };
  },
});

export const noteSearchTool = defineTool({
  name: "note_search",
  description:
    "Free local keyword search (zero tokens, no model): finds notes whose text contains every query word, ranked by occurrences, with a short snippet per hit. Zones: writing (default ./notes), memory (./memory, archives excluded), or all.",
  parameters: {
    query: { type: "string", description: 'Keywords, e.g. "pnpm merge commits".' },
    zone: { type: "string", description: '"writing", "memory" or "all" (default all).' },
    limit: { type: "number", description: "Max hits (default 10, cap 50)." },
    dir: {
      type: "string",
      description: "Optional writing directory override (./notes by default).",
    },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        zone: { type: "string" },
        dir: { type: "string" },
        hits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              title: { type: "string" },
              type: { type: "string" },
              tags: { type: "string" },
              snippet: { type: "string" },
              score: { type: "number" },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { hits?: { name?: string; title?: string; snippet?: string }[] };
      if (!v.hits || v.hits.length === 0) return [{ type: "text", text: "No matches." }];
      const lines = v.hits.map(
        (hit, index) => `[${index + 1}] ${hit.title ?? hit.name}\n${hit.snippet ?? ""}`,
      );
      return [{ type: "text", text: lines.join("\n\n") }];
    },
  },
  async execute(args, exec) {
    const { query, zone: zoneValue, limit, dir } = (args ?? {}) as Record<string, unknown>;
    if (typeof query !== "string" || query.trim() === "") throw new Error("A query is required.");
    const zone = zoneValue === "memory" || zoneValue === "writing" ? zoneValue : "all";
    const cwd = cwdOf(exec as ExecShape | undefined);
    const limitNum = clampSearchLimit(number(limit));
    const writingRoot = zoneDir("writing", cwd, text(dir));
    const memoryRoot = zoneDir("memory", cwd, undefined);
    const zones =
      zone === "all" ? [writingRoot, memoryRoot] : [zoneDir(zone as Zone, cwd, text(dir))];
    const hits = [];
    for (const root of zones) {
      const found = await searchNotes(root, query.trim(), { limit: limitNum });
      // Archives are never searched in the memory zone, wherever they are hit.
      const visible = root === memoryRoot ? visibleOnly(found, false) : found;
      for (const hit of visible) {
        const slim = { name: hit.name, snippet: hit.snippet, score: hit.score } as Record<
          string,
          unknown
        >;
        if (hit.title) slim.title = hit.title;
        if (hit.meta.type) slim.type = hit.meta.type;
        if (hit.meta.tags) slim.tags = hit.meta.tags;
        hits.push(slim);
      }
    }
    hits.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
    return { query: query.trim(), zone, dir: zones.join(" + "), hits: hits.slice(0, limitNum) };
  },
});

export const noteForgetTool = defineTool({
  name: "note_forget",
  description:
    "Remove a note file from a zone (writing default, or memory) by moving it to the zone's .trash/ folder, where it is hidden from every listing and search but can be restored by moving it back. permanent: true deletes it instead. No-op when it does not exist. For deleting single memory entries use memory_remove.",
  parameters: {
    name: { type: "string", description: "Note filename to remove." },
    zone: { type: "string", description: '"writing" (default) or "memory".' },
    permanent: {
      type: "boolean",
      description: "Delete for good instead of moving to .trash/ (default false).",
    },
    dir: { type: "string", description: "Optional directory override for the selected zone." },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        removed: { type: "boolean" },
        trashed: { type: "string" },
        zone: { type: "string" },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { name?: string; removed?: boolean; trashed?: string };
      return [{ type: "text", text: forgetText(v.name ?? "note", v.removed, v.trashed) }];
    },
  },
  async execute(args, exec) {
    const { name, zone: zoneValue, permanent, dir } = (args ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) throw new Error("A note name is required.");
    const zone = zoneArg(zoneValue, "writing");
    const root = zoneDir(zone, cwdOf(exec as ExecShape | undefined), text(dir));
    if (booleanOf(permanent)) {
      return { name: name.trim(), removed: await deleteNote(root, name.trim()), zone };
    }
    const trashed = await trashNote(root, name.trim());
    return trashed
      ? { name: name.trim(), removed: true, trashed, zone }
      : { name: name.trim(), removed: false, zone };
  },
});

export const noteStatsTool = defineTool({
  name: "note_stats",
  description:
    "Size up a zone for free before recalling: live file count, archive count, memory entry count, total bytes, the largest file, and the most used tags with their note counts. Use it to choose how much to recall, which tags to filter note_list/memory_recall by, or whether compacting the bank would pay off.",
  parameters: {
    zone: { type: "string", description: '"writing" (default) or "memory".' },
    dir: { type: "string", description: "Optional directory override for the selected zone." },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        zone: { type: "string" },
        dir: { type: "string" },
        files: { type: "number" },
        archives: { type: "number" },
        entries: { type: "number" },
        bytes: { type: "number" },
        largestName: { type: "string" },
        largestBytes: { type: "number" },
        tags: {
          type: "array",
          items: {
            type: "object",
            properties: { tag: { type: "string" }, count: { type: "number" } },
            additionalProperties: false,
          },
        },
        moreTags: { type: "number" },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as {
        tags?: { tag: string; count: number }[];
        moreTags?: number;
        zone?: string;
        dir?: string;
        files?: number;
        archives?: number;
        entries?: number;
        bytes?: number;
        largestName?: string;
        largestBytes?: number;
      };
      const lines = [
        `${v.dir ?? "?"} [${v.zone ?? "writing"}]`,
        `files: ${v.files ?? 0} (+${v.archives ?? 0} archive)`,
        `entries: ${v.entries ?? 0}`,
        `bytes: ${v.bytes ?? 0}`,
      ];
      if (v.largestName) lines.push(`largest: ${v.largestName} (${v.largestBytes ?? 0} bytes)`);
      const tagLine = renderTagCounts(v.tags ?? [], v.moreTags ?? 0);
      if (tagLine) lines.push(tagLine);
      return [{ type: "text", text: lines.join("\n") }];
    },
  },
  async execute(args, exec) {
    const { zone: zoneValue, dir } = (args ?? {}) as Record<string, unknown>;
    const zone = zoneArg(zoneValue, "writing");
    const root = zoneDir(zone, cwdOf(exec as ExecShape | undefined), text(dir));
    const stats = await zoneStats(root);
    return {
      zone,
      dir: stats.dir,
      files: stats.files,
      archives: stats.archives,
      entries: stats.entries,
      bytes: stats.bytes,
      largestName: stats.largest?.name ?? "",
      largestBytes: stats.largest?.bytes ?? 0,
      tags: stats.tags.slice(0, STATS_TAGS_SHOWN),
      moreTags: Math.max(0, stats.tags.length - STATS_TAGS_SHOWN),
    };
  },
});

export const noteMapTool = defineTool({
  name: "note_map",
  description:
    "Outline a zone cheaply: one line per file plus each file's newest entry headings, bounded by chars. Use it to see what a bank holds (topics and recency) before deciding which file to recall, or to spot a file worth compacting. Headings usually carry the gist, so this costs far less than recalling bodies.",
  parameters: {
    zone: { type: "string", description: '"writing" (default) or "memory".' },
    chars: {
      type: "number",
      description: "Character budget for the outline (default 1200, cap 20000).",
    },
    dir: { type: "string", description: "Optional directory override for the selected zone." },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        zone: { type: "string" },
        dir: { type: "string" },
        total: { type: "number" },
        omitted: { type: "number" },
        truncated: { type: "boolean" },
        links: { type: "number" },
        broken: { type: "array", items: { type: "string" } },
        orphans: { type: "array", items: { type: "string" } },
        islands: { type: "array", items: { type: "array", items: { type: "string" } } },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              title: { type: "string" },
              entries: { type: "number" },
              bytes: { type: "number" },
              headings: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as ZoneMap & { zone?: string };
      return [{ type: "text", text: renderZoneMap(v, v.zone ?? "zone") }];
    },
  },
  async execute(args, exec) {
    const { zone: zoneValue, chars, dir } = (args ?? {}) as Record<string, unknown>;
    const zone = zoneArg(zoneValue, "writing");
    const root = zoneDir(zone, cwdOf(exec as ExecShape | undefined), text(dir));
    const map = await zoneMap(root, {
      chars: number(chars),
      includeArchives: zone !== "memory",
    });
    return { zone, ...map };
  },
});

export const noteRenameTool = defineTool({
  name: "note_rename",
  description:
    "Rename or move a note inside a zone and rewrite every link that pointed at it, so the graph stays intact. Wikilinks keep their style (no extension), markdown links keep their extension, and anchors and |labels survive. dryRun reports the plan without moving anything; a name that already exists is refused rather than overwritten.",
  parameters: {
    from: { type: "string", description: "Current note name, e.g. session.md." },
    to: { type: "string", description: "New name or nested path, e.g. log/session.md." },
    dryRun: {
      type: "boolean",
      description: "Report what would change without renaming anything.",
    },
    zone: { type: "string", description: '"writing" (default) or "memory".' },
    dir: { type: "string", description: "Optional directory override for the selected zone." },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        zone: { type: "string" },
        dir: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        path: { type: "string" },
        moved: { type: "boolean" },
        dryRun: { type: "boolean" },
        rewritten: { type: "array", items: { type: "string" } },
        links: { type: "number" },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as {
        from?: string;
        to?: string;
        dryRun?: boolean;
        links?: number;
        rewritten?: string[];
      };
      const verb = v.dryRun ? "Would rename" : "Renamed";
      const notes = v.rewritten?.length ?? 0;
      const links = v.links ?? 0;
      const suffix = links > 0 ? `, ${links} link(s) in ${notes} note(s)` : ", no links to rewrite";
      return [{ type: "text", text: `${verb} ${v.from ?? "?"} -> ${v.to ?? "?"}${suffix}` }];
    },
  },
  async execute(args, exec) {
    const { from, to, dryRun, zone: zoneValue, dir } = (args ?? {}) as Record<string, unknown>;
    if (typeof from !== "string" || !from.trim()) {
      throw new Error("A current note name is required.");
    }
    if (typeof to !== "string" || !to.trim()) throw new Error("A new note name is required.");
    const zone = zoneArg(zoneValue, "writing");
    const root = zoneDir(zone, cwdOf(exec as ExecShape | undefined), text(dir));
    const result = await renameNote(root, from.trim(), to.trim(), {
      dryRun: booleanOf(dryRun),
      includeArchives: zone !== "memory",
    });
    return { zone, dir: result.path, ...result };
  },
});

export const noteLinksTool = defineTool({
  name: "note_links",
  description:
    "Follow links between notes for free. With a name: what that note points at, what points back at it, and its dangling targets. Without one: the zone's link count, the notes nothing links to or from, link clusters cut off from the main one, and every broken target. Targets resolve by path, then file name, then a front matter alias. Use it to reach related notes without keyword search, and to notice stranded ones.",
  parameters: {
    name: { type: "string", description: "Optional note to focus on, e.g. session.md." },
    zone: { type: "string", description: '"writing" (default) or "memory".' },
    dir: { type: "string", description: "Optional directory override for the selected zone." },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        zone: { type: "string" },
        dir: { type: "string" },
        files: { type: "number" },
        links: { type: "number" },
        broken: { type: "array", items: { type: "string" } },
        orphans: { type: "array", items: { type: "string" } },
        islands: { type: "array", items: { type: "array", items: { type: "string" } } },
        note: {
          type: "object",
          properties: {
            name: { type: "string" },
            out: { type: "array", items: { type: "string" } },
            back: { type: "array", items: { type: "string" } },
            broken: { type: "array", items: { type: "string" } },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as LinkReport & { zone?: string };
      return [{ type: "text", text: renderLinkReport(v, v.zone ?? "zone") }];
    },
  },
  async execute(args, exec) {
    const { name, zone: zoneValue, dir } = (args ?? {}) as Record<string, unknown>;
    const zone = zoneArg(zoneValue, "writing");
    const root = zoneDir(zone, cwdOf(exec as ExecShape | undefined), text(dir));
    const report = await linkReport(root, {
      name: text(name),
      includeArchives: zone !== "memory",
    });
    return {
      zone,
      dir: report.dir,
      files: report.files,
      links: report.links,
      broken: report.broken,
      orphans: report.orphans,
      islands: report.islands,
      // Absent rather than undefined: the schema has no place for undefined.
      ...(report.note ? { note: report.note } : {}),
    };
  },
});

export const noteContextTool = defineTool({
  name: "note_context",
  description:
    "Assemble a small, bounded context packet from local notes and long-term memory around a focus — the free step before spending tokens on real reasoning. Includes the recent tail of named writing notes, search snippets for the focus, and the recent/relevant memory tail; older parts are dropped first when the budget is tight. Feed the result to your next reasoning step (summarize, infer what comes next, extract key info, plan edits) instead of re-reading whole files.",
  parameters: {
    focus: {
      type: "string",
      description: "Question/topic that narrows memory recall and writing-zone search.",
    },
    notes: {
      type: "array",
      items: { type: "string" },
      description: "Writing-zone note names to include their recent tail of.",
    },
    chars: { type: "number", description: "Total budget in characters (default 6000, cap 20000)." },
    dir: {
      type: "string",
      description: "Optional writing directory override (./notes by default).",
    },
    memoryDir: {
      type: "string",
      description: "Optional memory directory override (./memory by default).",
    },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        context: { type: "string" },
        chars: { type: "number" },
        parts: { type: "number" },
        truncated: { type: "boolean" },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { context?: string; parts?: number; truncated?: boolean };
      const body =
        v.context && v.context.length > 0 ? v.context : "(nothing matched the context request)";
      return [
        {
          type: "text",
          text: `${body}\n\n[context parts: ${v.parts ?? 0}, truncated: ${v.truncated ?? false}]`,
        },
      ];
    },
  },
  async execute(args, exec) {
    const { focus, notes, chars, dir, memoryDir } = (args ?? {}) as Record<string, unknown>;
    const result = await buildContext({
      focus: text(focus),
      notes: Array.isArray(notes)
        ? notes.filter((item): item is string => typeof item === "string")
        : [],
      chars: number(chars),
      cwd: cwdOf(exec as ExecShape | undefined),
      writingDir: text(dir),
      memoryDir: text(memoryDir),
    });
    return {
      context: result.context,
      chars: result.chars,
      parts: result.parts,
      truncated: result.truncated,
    };
  },
});
