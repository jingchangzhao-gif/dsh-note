// The dsh tools for local notes (writing zone, ./notes by default) plus the
// generic ones: list, free keyword search across zones, forget, and the
// context assembler that feeds the model the small relevant chunk before it
// thinks. Every tool here is FREE file work — no model calls happen inside.

import { defineTool } from "@deepseek-ai/dsh-tools";
import { buildContext } from "./context";
import {
  appendNote,
  clampChars,
  COMPACT_BUDGET,
  compactTail,
  deleteNote,
  editNote,
  isArchive,
  listNotes,
  readNoteFull,
  searchNotes,
  tailText,
  writeNote,
  zoneRoot,
} from "./notes";
import type { NoteFile, Zone } from "./notes";
import { booleanOf, cwdOf, number, text, type ExecShape } from "./tool-util";

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
}

function toSummary(file: NoteFile): NoteSummary {
  const out: NoteSummary = { name: file.name, path: file.path };
  if (file.title) out.title = file.title;
  if (file.meta.type) out.type = file.meta.type;
  if (file.meta.tags) out.tags = file.meta.tags;
  if (file.meta.updated) out.updated = file.meta.updated;
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
    "Read a note back (front matter included). Use tail to pull only the most recent characters. Use compact to get a small view — the summary front matter field plus the recent tail — when the note is long. Keeps context and token cost small.",
  parameters: {
    name: { type: "string", description: "Note filename, e.g. session.md." },
    tail: { type: "number", description: "Optional: return only the last N characters." },
    compact: {
      type: "boolean",
      description:
        "Optional: small view (summary field + recent ~800 chars) instead of the full note.",
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
    const { name, tail, compact, dir } = (args ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) throw new Error("A note name is required.");
    const zone = zoneDir("writing", cwdOf(exec as ExecShape | undefined), text(dir));
    const full = await readNoteFull(zone, name.trim());
    if (booleanOf(compact)) {
      const body = full.body.trim();
      const recent = compactTail(body);
      const summary = text(full.meta.summary);
      const content = summary ? `summary: ${summary}\n\n${recent}` : recent;
      return { name: full.name, content, truncated: body.length > COMPACT_BUDGET };
    }
    if (tail == null) return { name: full.name, content: full.raw, truncated: false };
    const content = tailText(full.raw, number(tail) ?? 1);
    return { name: full.name, content, truncated: full.raw.length > clampChars(number(tail) ?? 1) };
  },
});

export const noteListTool = defineTool({
  name: "note_list",
  description:
    "List the local notes of a zone (writing ./notes by default, or the long-term memory ./memory zone). Archive files (type archive) are hidden from the memory listing.",
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
        notes: { type: "array", items: noteSummarySchema },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { zone?: string; dir?: string; notes?: NoteSummary[] };
      const lines = [`Notes [${v.zone ?? "writing"}] in ${v.dir ?? "?"}:`];
      for (const note of v.notes ?? []) {
        lines.push(`- ${note.name}${note.title ? ` — ${note.title}` : ""}`);
      }
      return [{ type: "text", text: lines.join("\n") }];
    },
  },
  async execute(args, exec) {
    const { zone: zoneValue, dir } = (args ?? {}) as Record<string, unknown>;
    const zone = zoneArg(zoneValue, "writing");
    const root = zoneDir(zone, cwdOf(exec as ExecShape | undefined), text(dir));
    const all = await listNotes(root);
    const notes = (
      zone === "memory" ? all.filter((f) => !isArchive(f.name, f.meta)) : all
    ).map(toSummary);
    return { zone, dir: root, notes };
  },
});

export const noteWriteTool = defineTool({
  name: "note_write",
  description:
    "Fully replace a note's body in the writing zone (creating it when missing) — for updates, rewrites and reordering, not just appends. Front matter fields given here merge in; existing fields are preserved; updated is maintained.",
  parameters: {
    name: { type: "string", description: "Note filename, e.g. article.md." },
    content: { type: "string", description: "The new full body (markdown)." },
    title: { type: "string", description: "Optional front matter title." },
    tags: { type: "string", description: "Optional comma separated front matter tags." },
    type: { type: "string", description: "Optional front matter type (e.g. article)." },
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
    const { name, content, title, tags, type, dir } = (args ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) throw new Error("A note name is required.");
    if (typeof content !== "string") throw new Error("Note content is required.");
    const patch: Record<string, string> = {};
    if (typeof title === "string" && title.trim()) patch.title = title.trim();
    if (typeof tags === "string" && tags.trim()) patch.tags = tags.trim();
    if (typeof type === "string" && type.trim()) patch.type = type.trim();
    const zone = zoneDir("writing", cwdOf(exec as ExecShape | undefined), text(dir));
    const result = await writeNote(zone, name.trim(), content, patch);
    return { name: result.name, path: result.path, created: result.created };
  },
});

export const noteEditTool = defineTool({
  name: "note_edit",
  description:
    'Edit a note\'s body in place with literal text replacements (front matter is never matched). Without all=true only the first occurrence is replaced; new="" deletes the match. Use for targeted updates after the model decided what to change.',
  parameters: {
    name: { type: "string", description: "Note filename, e.g. session.md." },
    old: { type: "string", description: "Literal text to find (body only)." },
    new: { type: "string", description: "Replacement text (default empty = delete)." },
    all: { type: "boolean", description: "Replace every occurrence instead of just the first." },
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
    const { name, old, new: replacement, all, dir } = (args ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) throw new Error("A note name is required.");
    if (typeof old !== "string" || old === "") throw new Error("old text to find is required.");
    const zone = zoneDir("writing", cwdOf(exec as ExecShape | undefined), text(dir));
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
    const limitNum = Math.max(1, Math.min(Math.round(number(limit) ?? 10), 50));
    const writingRoot = zoneDir("writing", cwd, text(dir));
    const memoryRoot = zoneDir("memory", cwd, undefined);
    const zones =
      zone === "all" ? [writingRoot, memoryRoot] : [zoneDir(zone as Zone, cwd, text(dir))];
    const hits = [];
    for (const root of zones) {
      const found = await searchNotes(root, query.trim(), { limit: limitNum });
      for (const hit of found) {
        if (root === memoryRoot && isArchive(hit.name, hit.meta)) continue;
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
    "Delete a note file from a zone (writing default, or memory). No-op when it does not exist. For deleting single memory entries use memory_remove.",
  parameters: {
    name: { type: "string", description: "Note filename to delete." },
    zone: { type: "string", description: '"writing" (default) or "memory".' },
    dir: { type: "string", description: "Optional directory override for the selected zone." },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        removed: { type: "boolean" },
        zone: { type: "string" },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { name?: string; removed?: boolean };
      return [
        {
          type: "text",
          text: `Forgot ${v.name ?? "note"} (removed: ${v.removed ?? false})`,
        },
      ];
    },
  },
  async execute(args, exec) {
    const { name, zone: zoneValue, dir } = (args ?? {}) as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) throw new Error("A note name is required.");
    const zone = zoneArg(zoneValue, "writing");
    const root = zoneDir(zone, cwdOf(exec as ExecShape | undefined), text(dir));
    const removed = await deleteNote(root, name.trim());
    return { name: name.trim(), removed, zone };
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
