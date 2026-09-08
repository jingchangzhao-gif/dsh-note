// The dsh tools for the long-term memory bank (memory/ zone).
// Every tool here is FREE file work: entries are appended, recalled in small
// bounded chunks, updated, compacted, or removed — no model is called. The
// model only spends tokens later, when it actually thinks about what these
// tools hand back.

import { defineTool } from "@deepseek-ai/dsh-tools";
import { zoneRoot } from "./notes";
import {
  addMemoryEntry,
  compactMemory,
  DEFAULT_MEMORY_NOTE,
  recallMemory,
  removeMemoryEntries,
  updateMemoryMeta,
} from "./memory";
import { cwdOf, text, type ExecShape } from "./tool-util";

function memoryZone(cwd: string | undefined, dir?: string): string {
  return zoneRoot("memory", cwd, dir);
}

const resultSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    path: { type: "string" },
  },
  additionalProperties: false,
} as const;

export const memoryAddTool = defineTool({
  name: "memory_add",
  description:
    "Append one timestamped entry to the long-term memory bank (default file memory.md). Use to store durable facts, decisions and preferences that later turns should recall — without re-sending them every time.",
  parameters: {
    content: { type: "string", description: "The fact/decision to remember (markdown ok)." },
    name: {
      type: "string",
      description: `Topic file, e.g. decisions.md (default ${DEFAULT_MEMORY_NOTE}).`,
    },
    title: {
      type: "string",
      description: "Optional entry title appended to the timestamp heading.",
    },
    tags: {
      type: "string",
      description: "Optional comma separated tags stored on the file front matter.",
    },
    type: { type: "string", description: "Optional front matter type (default memory)." },
    dir: { type: "string", description: "Optional memory directory override." },
  },
  output: {
    schema: resultSchema,
    render: (_args, value) => [
      {
        type: "text",
        text: `Remembered in ${(value as { name?: string }).name ?? DEFAULT_MEMORY_NOTE}`,
      },
    ],
  },
  async execute(args, exec) {
    const { content, name, title, tags, type, dir } = (args ?? {}) as Record<string, unknown>;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Content to remember is required.");
    }
    return addMemoryEntry(
      memoryZone(cwdOf(exec as ExecShape | undefined), text(dir)),
      content,
      {
        name: text(name),
        title: text(title),
        tags: text(tags),
        type: text(type),
      },
    );
  },
});

export const memoryRecallTool = defineTool({
  name: "memory_recall",
  description:
    "Recall the small relevant chunk of the long-term memory bank: newest entries first, bounded by limit and chars. Filter by name/query/tags/type/dates. Without filters this is just the recent tail — never the whole history — keeping token cost minimal.",
  parameters: {
    name: { type: "string", description: "Limit to one topic file, e.g. decisions.md." },
    query: {
      type: "string",
      description: "Keywords; entries must contain every word (substring match).",
    },
    tags: {
      type: "string",
      description: "Comma separated; only files carrying any of these tags.",
    },
    type: { type: "string", description: "Only files whose front matter type equals this." },
    newerThan: { type: "string", description: "Only entries at/after this date (ISO)." },
    olderThan: { type: "string", description: "Only entries at/before this date (ISO)." },
    limit: { type: "number", description: "Max entries (default 10, cap 100)." },
    chars: { type: "number", description: "Character budget for the reply (default 4000)." },
    dir: { type: "string", description: "Optional memory directory override." },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        content: { type: "string" },
        files: { type: "number" },
        truncated: { type: "boolean" },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { content?: string };
      return [
        {
          type: "text",
          text: v.content && v.content.length > 0 ? v.content : "(no memory matched)",
        },
      ];
    },
  },
  async execute(args, exec) {
    const { name, query, tags, type, newerThan, olderThan, limit, chars, dir } = (args ??
      {}) as Record<string, unknown>;
    return recallMemory(
      memoryZone(cwdOf(exec as ExecShape | undefined), text(dir)),
      {
        name: text(name),
        query: text(query),
        tags: text(tags),
        type: text(type),
        newerThan: text(newerThan),
        olderThan: text(olderThan),
        limit: typeof limit === "number" ? limit : undefined,
        chars: typeof chars === "number" ? chars : undefined,
      },
    );
  },
});

export const memoryUpdateTool = defineTool({
  name: "memory_update",
  description:
    "Update a long-term memory file: merge front matter fields (title/tags/type/summary) and/or append an entry. Use it to edit an existing memory file rather than only appending, e.g. store a compact digest in the summary field.",
  parameters: {
    name: { type: "string", description: `Topic file (default ${DEFAULT_MEMORY_NOTE}).` },
    meta: {
      type: "object",
      description: "Front matter fields to merge onto the file.",
      properties: {
        title: { type: "string" },
        tags: { type: "string", description: "Comma separated tag list." },
        type: { type: "string" },
        summary: {
          type: "string",
          description: "Compact one-paragraph digest shown by compact recalls.",
        },
      },
      additionalProperties: false,
    },
    content: { type: "string", description: "Optional entry to append (same as memory_add)." },
    dir: { type: "string", description: "Optional memory directory override." },
  },
  output: {
    schema: {
      type: "object",
      properties: { name: { type: "string" }, changed: { type: "boolean" } },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { name?: string; changed?: boolean };
      return [
        {
          type: "text",
          text: `Updated ${v.name ?? DEFAULT_MEMORY_NOTE} (changed: ${v.changed ?? false})`,
        },
      ];
    },
  },
  async execute(args, exec) {
    const { name, meta, content, dir } = (args ?? {}) as Record<string, unknown>;
    const zone = memoryZone(
      cwdOf(exec as ExecShape | undefined),
      text(dir),
    );
    const topic = typeof name === "string" && name.trim() ? name.trim() : DEFAULT_MEMORY_NOTE;
    const patch: Record<string, string> = {};
    if (meta && typeof meta === "object") {
      for (const key of ["title", "tags", "type", "summary"] as const) {
        const value = (meta as Record<string, unknown>)[key];
        if (typeof value === "string" && value.trim() !== "") patch[key] = value.trim();
      }
    }
    let changed = false;
    if (typeof content === "string" && content.trim()) {
      await addMemoryEntry(zone, content, { name: topic });
      changed = true;
    }
    if (Object.keys(patch).length > 0) {
      const result = await updateMemoryMeta(zone, topic, patch);
      changed = result.changed || changed;
    } else if (!changed) {
      throw new Error("Nothing to update: give content to append or meta fields to set.");
    }
    return { name: topic, changed };
  },
});

export const memoryCompactTool = defineTool({
  name: "memory_compact",
  description:
    "Keep a long-term memory file small for free: move its older entries (all but the newest `keep`, or everything older than `olderThan`) into a sibling *.archive.md file. The active file keeps its front matter, so future recalls stay cheap. If you want a real digest, first recall, then have the model write a summary into the file's summary field via memory_update — that thinking step is the only paid part.",
  parameters: {
    name: { type: "string", description: `Topic file (default ${DEFAULT_MEMORY_NOTE}).` },
    keep: { type: "number", description: "Keep only the newest N entries (default 20)." },
    olderThan: {
      type: "string",
      description: "Alternative: archive everything older than this date (ISO).",
    },
    dir: { type: "string", description: "Optional memory directory override." },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        path: { type: "string" },
        kept: { type: "number" },
        archived: { type: "number" },
        archive: { type: "string" },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { name?: string; kept?: number; archived?: number; archive?: string };
      const moved = v.archive ? ` → ${v.archive}` : "";
      return [
        {
          type: "text",
          text: `Compacted ${v.name ?? DEFAULT_MEMORY_NOTE}: kept ${v.kept ?? 0}, archived ${v.archived ?? 0}${moved}`,
        },
      ];
    },
  },
  async execute(args, exec) {
    const { name, keep, olderThan, dir } = (args ?? {}) as Record<string, unknown>;
    return compactMemory(
      memoryZone(cwdOf(exec as ExecShape | undefined), text(dir)),
      {
        name: text(name),
        keep: typeof keep === "number" ? keep : undefined,
        olderThan: text(olderThan),
      },
    );
  },
});

export const memoryRemoveTool = defineTool({
  name: "memory_remove",
  description:
    "Permanently delete every long-term memory entry whose text contains the given match (deliberate discard — unlike memory_compact nothing is archived).",
  parameters: {
    match: { type: "string", description: "Literal text identifying the entry/entries to delete." },
    name: { type: "string", description: `Topic file (default ${DEFAULT_MEMORY_NOTE}).` },
    dir: { type: "string", description: "Optional memory directory override." },
  },
  output: {
    schema: {
      type: "object",
      properties: { name: { type: "string" }, removed: { type: "number" } },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { name?: string; removed?: number };
      return [
        {
          type: "text",
          text: `Removed ${v.removed ?? 0} entr${(v.removed ?? 0) === 1 ? "y" : "ies"} from ${v.name ?? DEFAULT_MEMORY_NOTE}`,
        },
      ];
    },
  },
  async execute(args, exec) {
    const { match, name, dir } = (args ?? {}) as Record<string, unknown>;
    if (typeof match !== "string" || !match.trim()) throw new Error("A match text is required.");
    const zone = memoryZone(
      cwdOf(exec as ExecShape | undefined),
      text(dir),
    );
    const topic = typeof name === "string" && name.trim() ? name.trim() : DEFAULT_MEMORY_NOTE;
    return removeMemoryEntries(zone, topic, match);
  },
});
