// The four dsh memory tools: remember, recall, list, forget.

import { defineTool } from "@deepseek-ai/dsh-tools";
import { resolveMemoryDir, listNotes, readNote, appendNote, deleteNote } from "./notes";

interface ExecShape {
  agent?: { session?: { header?: { cwd?: string } } };
}

function baseDir(args: { dir?: string }, exec: ExecShape): string {
  return resolveMemoryDir(exec.agent?.session?.header?.cwd, args.dir);
}

const noteSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    path: { type: "string" },
    title: { type: "string" },
  },
  additionalProperties: false,
} as const;

export const noteRememberTool = defineTool({
  name: "note_remember",
  description:
    "Append a memory snippet to a named note (creating it if missing). Use to persist context instead of re-sending it every turn.",
  parameters: {
    name: { type: "string", description: "Note filename, e.g. session.md." },
    content: { type: "string", description: "Markdown/text to remember." },
    dir: { type: "string", description: "Optional memory directory override." },
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
    const { name, content } = args ?? {};
    if (!name) throw new Error("A note name is required.");
    if (!content) throw new Error("Content to remember is required.");
    const dir = baseDir(args ?? {}, exec);
    return appendNote(dir, name, content);
  },
});

export const noteRecallTool = defineTool({
  name: "note_recall",
  description:
    "Read a memory note back. Use optional tail to pull only the most recent characters, keeping context small.",
  parameters: {
    name: { type: "string", description: "Note filename, e.g. session.md." },
    tail: { type: "number", description: "Optional: return only the last N characters." },
    dir: { type: "string", description: "Optional memory directory override." },
  },
  output: {
    schema: {
      type: "object",
      properties: { name: { type: "string" }, content: { type: "string" } },
      additionalProperties: false,
    },
    render: (_args, value) => [{ type: "text", text: (value as { content?: string }).content ?? "" }],
  },
  async execute(args, exec) {
    const { name, tail } = args ?? {};
    if (!name) throw new Error("A note name is required.");
    const dir = baseDir(args ?? {}, exec);
    const content = await readNote(dir, name, tail);
    return { name, content };
  },
});

export const noteListTool = defineTool({
  name: "note_list",
  description: "List what is in memory (note files and their first headings).",
  parameters: {
    dir: { type: "string", description: "Optional memory directory override." },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        notes: { type: "array", items: noteSchema },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { dir?: string; notes?: { name: string; title?: string }[] };
      const lines = [`Memory in ${v.dir ?? "?"}:`];
      for (const n of v.notes ?? []) lines.push(`- ${n.name}${n.title ? ` — ${n.title}` : ""}`);
      return [{ type: "text", text: lines.join("\n") }];
    },
  },
  async execute(args, exec) {
    const dir = baseDir(args ?? {}, exec);
    const notes = await listNotes(dir);
    return { dir, notes };
  },
});

export const noteForgetTool = defineTool({
  name: "note_forget",
  description: "Delete a memory note (no-op if it does not exist).",
  parameters: {
    name: { type: "string", description: "Note filename to delete." },
    dir: { type: "string", description: "Optional memory directory override." },
  },
  output: {
    schema: {
      type: "object",
      properties: { name: { type: "string" }, removed: { type: "boolean" } },
      additionalProperties: false,
    },
    render: (_args, value) => [
      { type: "text", text: `Forgot ${(value as { name?: string }).name ?? "note"} (removed: ${(value as { removed?: boolean }).removed ?? false})` },
    ],
  },
  async execute(args, exec) {
    const { name } = args ?? {};
    if (!name) throw new Error("A note name is required.");
    const dir = baseDir(args ?? {}, exec);
    const removed = await deleteNote(dir, name);
    return { name, removed };
  },
});
