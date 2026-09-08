#!/usr/bin/env node
// dsh-note CLI — the token-free functional layer over a folder of notes.
//
// Usage:
//   node cli.mjs <command> [dir] [flags...]     # run.bat / run.command forward everything
//   node cli.mjs [dir]                          # legacy: list that directory
//
// Commands: list, remember, recall, write, edit, search, forget, context,
//           memory-add, memory-recall, memory-update, memory-compact,
//           memory-remove, help.
//
// Every command is plain local file work — no model, no network, no tokens.
// `dir` is the folder the command operates on (the notes folder for the
// plain commands; the memory-bank folder for the memory-* commands). When
// omitted, plain commands default to ./notes and memory-* to ./memory,
// relative to the current working directory.
//
// Long text values travel safely as flags; for Chinese/multiline content use
// --file <path> or pass - as --content to read UTF-8 from stdin.

import { readFile } from "node:fs/promises";

const api = await import("./lib/api.js");

const NAME = "dsh-note";
const COMMANDS = new Set([
  "list",
  "remember",
  "recall",
  "write",
  "edit",
  "search",
  "forget",
  "context",
  "memory-add",
  "memory-recall",
  "memory-update",
  "memory-compact",
  "memory-remove",
  "help",
]);

const HELP = `dsh-note — local markdown notes + memory bank (token-free file work)

Usage:
  run.bat <command> [dir] [flags...]        (Windows)
  ./run.command <command> [dir] [flags...]  (macOS)
  node cli.mjs <command> [dir] [flags...]

Commands (dir defaults to ./notes, or ./memory for memory-*):
  list [dir]
      List note files with title/type/tags. --json for raw data.
  remember <dir?> --name <file> [--content <text> | --file <path> | --content -]
      Append a block to a writing note (creating it when missing).
  recall <dir?> --name <file> [--tail <chars>] [--compact]
      Read a note back; tail = recent characters, compact = summary + tail.
  write <dir?> --name <file> (--content <text> | --file <path> | --content -)
      Replace a note's whole body; optional --title/--tags/--type.
  edit <dir?> --name <file> --old <text> [--new <text>] [--all]
      Literal in-place body edit (front matter is never matched).
  search <dir?> --query <words> [--limit <n>] [--all]
      Free keyword search with snippets (--all also matches archives).
  forget <dir?> --name <file>
      Delete a note file.
  context <dir?> [--focus <text>] [--notes a.md,b.md] [--chars <n>] [--memory <dir>]
      Assemble a small bounded context packet (writing tails + focus hits +
      recent memory tail; older parts drop first under budget).
  memory-add <dir?> (--content <text> | --file <path>) [--name <file>]
      [--title <t>] [--tags <a,b>] [--type <t>]
      Append one timestamped entry to the long-term memory bank.
  memory-recall <dir?> [--query <words>] [--name <file>] [--tags <a,b>]
      [--type <t>] [--newer-than <date>] [--older-than <date>]
      [--limit <n>] [--chars <n>]
      Recall the recent/relevant small chunk (newest first, bounded).
  memory-update <dir?> [--name <file>] [--title/--tags/--type/--summary <v>]
      [--content <text> | --file <path>]
      Merge front matter fields and/or append an entry.
  memory-compact <dir?> [--name <file>] [--keep <n> | --older-than <date>]
      Move older entries into <file stem>.archive.md (free archive).
  memory-remove <dir?> --match <text> [--name <file>]
      Permanently delete matching entries.
  help | --help
      Show this help.

Convenience: the file name may be typed right after the directory —
  recall C:\notes session.md        (same as --name session.md)
  search C:\notes pnpm merge        (query words may follow the directory)

Add --json to print the structured result instead of plain text.
Content tips: quote multi-word values; use --file/- for Chinese or multiline.`;

function parseArgs(tokens) {
  const positional = [];
  const flags = {};
  const booleanFlags = new Set(["compact", "all", "json", "help"]);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      if (booleanFlags.has(key)) {
        flags[key] = true;
      } else {
        const value = tokens[i + 1];
        if (value === undefined) throw new Error(`flag --${key} needs a value`);
        flags[key] = value;
        i += 1;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function numberFlag(flags, key, label) {
  if (flags[key] === undefined) return undefined;
  const value = Number(flags[key]);
  if (!Number.isFinite(value)) throw new Error(`${label} must be a number, got: ${flags[key]}`);
  return value;
}

function requireFlag(flags, key, usage) {
  const value = flags[key];
  if (value === undefined || value === "") throw new Error(`missing --${key} (${usage})`);
  return value;
}

function zoneOf(kind, dirArg) {
  return api.zoneRoot(kind, process.cwd(), dirArg);
}

async function readContent(flags) {
  if (flags.file !== undefined) {
    try {
      return await readFile(flags.file, "utf8");
    } catch (error) {
      throw new Error(`cannot read --file ${flags.file}: ${error.message}`, { cause: error });
    }
  }
  const raw = flags.content ?? "";
  if (raw !== "-") return raw;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function listMetaSuffix(meta) {
  const parts = [];
  if (meta.type) parts.push(`[${meta.type}]`);
  if (meta.tags) parts.push(`tags: ${meta.tags}`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

const handlers = {
  help() {
    return { text: HELP };
  },

  async list({ positional, flags }) {
    const dir = zoneOf("writing", positional[0]);
    let notes = await api.listNotes(dir);
    if (!flags.all) {
      notes = notes.filter(
        (note) => note.meta.type !== "archive" && !note.name.includes(api.ARCHIVE_MARK),
      );
    }
    if (flags.json) return { json: notes };
    const lines = [`Notes in ${dir} (${notes.length}):`];
    for (const note of notes) {
      lines.push(
        `- ${note.name}${note.title ? ` — ${note.title}` : ""}${listMetaSuffix(note.meta)}`,
      );
    }
    return { text: lines.join("\n") };
  },

  async remember({ positional, flags }) {
    const dir = zoneOf("writing", positional[0]);
    const name = requireFlag(flags, "name", "note filename, e.g. session.md");
    const content = await readContent(flags);
    if (!content.trim())
      throw new Error("content is empty (use --content, --file <path>, or --content -)");
    const result = await api.appendNote(dir, name, content);
    if (flags.json) return { json: result };
    return { text: `Remembered in ${result.name}` };
  },

  async recall({ positional, flags }) {
    const dir = zoneOf("writing", positional[0]);
    const name = requireFlag(flags, "name", "note filename, e.g. session.md");
    const full = await api.readNoteFull(dir, name);
    if (flags.compact) {
      const budget = 800;
      const body = full.body.trim();
      const recent = body.length > budget ? `…${body.slice(-budget)}` : body;
      const summary = full.meta.summary;
      const content = summary ? `summary: ${summary}\n\n${recent}` : recent;
      if (flags.json)
        return { json: { name: full.name, content, truncated: body.length > budget } };
      return { text: content };
    }
    if (flags.tail !== undefined) {
      const chars = Math.min(
        Math.max(1, Math.round(numberFlag(flags, "tail", "--tail") ?? 1)),
        100_000,
      );
      const raw = full.raw;
      const content = raw.length <= chars ? raw : `…${raw.slice(-chars)}`;
      if (flags.json) return { json: { name: full.name, content, truncated: raw.length > chars } };
      return { text: content };
    }
    if (flags.json) return { json: { name: full.name, content: full.raw, truncated: false } };
    return { text: full.raw };
  },

  async write({ positional, flags }) {
    const dir = zoneOf("writing", positional[0]);
    const name = requireFlag(flags, "name", "note filename, e.g. article.md");
    const body = await readContent(flags);
    const patch = {};
    for (const key of ["title", "tags", "type"]) {
      if (flags[key] !== undefined) patch[key] = flags[key];
    }
    const result = await api.writeNote(dir, name, body, patch);
    if (flags.json) return { json: result };
    return { text: `Wrote ${result.name} (${result.created ? "created" : "updated"})` };
  },

  async edit({ positional, flags }) {
    const dir = zoneOf("writing", positional[0]);
    const name = requireFlag(flags, "name", "note filename, e.g. session.md");
    const old = requireFlag(flags, "old", "literal text to find");
    const replacement = flags.new ?? "";
    const result = await api.editNote(dir, name, [{ old, new: replacement, all: flags.all }]);
    if (flags.json) return { json: result };
    return {
      text: `Edited ${result.name}: ${result.edits} replacement(s), changed: ${result.changed}`,
    };
  },

  async search({ positional, flags }) {
    const dir = zoneOf("writing", positional[0]);
    const query = requireFlag(flags, "query", 'keywords, e.g. "pnpm merge"');
    const limit = Math.max(
      1,
      Math.min(Math.round(numberFlag(flags, "limit", "--limit") ?? 10), 50),
    );
    const hits = await api.searchNotes(dir, query, { limit });
    const visible = flags.all
      ? hits
      : hits.filter((hit) => hit.meta.type !== "archive" && !hit.name.includes(api.ARCHIVE_MARK));
    if (flags.json) return { json: { query, dir, hits: visible } };
    if (visible.length === 0) return { text: "No matches." };
    const lines = visible.map(
      (hit, index) =>
        `[${index + 1}] ${hit.title ?? hit.name} (score ${hit.score})\n${hit.snippet}`,
    );
    return { text: lines.join("\n\n") };
  },

  async forget({ positional, flags }) {
    const dir = zoneOf("writing", positional[0]);
    const name = requireFlag(flags, "name", "note filename to delete");
    const removed = await api.deleteNote(dir, name);
    if (flags.json) return { json: { name, removed } };
    return { text: `Forgot ${name} (removed: ${removed})` };
  },

  async context({ positional, flags }) {
    const notes =
      flags.notes !== undefined
        ? flags.notes
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    const result = await api.buildContext({
      focus: flags.focus,
      notes,
      chars: numberFlag(flags, "chars", "--chars"),
      cwd: process.cwd(),
      writingDir: positional[0],
      memoryDir: flags.memory,
    });
    if (flags.json) return { json: result };
    const body =
      result.context && result.context.length > 0
        ? result.context
        : "(nothing matched the context request)";
    return {
      text: `${body}\n\n[context parts: ${result.parts}, chars: ${result.chars}, truncated: ${result.truncated}]`,
    };
  },

  async "memory-add"({ positional, flags }) {
    const dir = zoneOf("memory", positional[0]);
    const content = await readContent(flags);
    if (!content.trim())
      throw new Error("content is empty (use --content, --file <path>, or --content -)");
    const result = await api.addMemoryEntry(dir, content, {
      name: flags.name,
      title: flags.title,
      tags: flags.tags,
      type: flags.type,
    });
    if (flags.json) return { json: result };
    return { text: `Remembered in ${result.name}` };
  },

  async "memory-recall"({ positional, flags }) {
    const dir = zoneOf("memory", positional[0]);
    const result = await api.recallMemory(dir, {
      name: flags.name,
      query: flags.query,
      tags: flags.tags,
      type: flags.type,
      newerThan: flags["newer-than"],
      olderThan: flags["older-than"],
      limit: numberFlag(flags, "limit", "--limit"),
      chars: numberFlag(flags, "chars", "--chars"),
    });
    if (flags.json) return { json: result };
    if (!result.content) return { text: "(no memory matched)" };
    return { text: result.content };
  },

  async "memory-update"({ positional, flags }) {
    const dir = zoneOf("memory", positional[0]);
    const name = flags.name || api.DEFAULT_MEMORY_NOTE;
    const patch = {};
    for (const key of ["title", "tags", "type", "summary"]) {
      if (flags[key] !== undefined && flags[key] !== "") patch[key] = flags[key];
    }
    const hasContent = flags.content !== undefined || flags.file !== undefined;
    let changed = false;
    if (hasContent) {
      const content = await readContent(flags);
      if (!content.trim())
        throw new Error("content is empty (use --content, --file <path>, or --content -)");
      await api.addMemoryEntry(dir, content, { name });
      changed = true;
    }
    if (Object.keys(patch).length > 0) {
      const result = await api.updateMemoryMeta(dir, name, patch);
      changed = result.changed || changed;
    }
    if (!changed)
      throw new Error("nothing to update: give --content/--file to append, or meta fields to set");
    if (flags.json) return { json: { name, changed } };
    return { text: `Updated ${name} (changed: ${changed})` };
  },

  async "memory-compact"({ positional, flags }) {
    const dir = zoneOf("memory", positional[0]);
    const result = await api.compactMemory(dir, {
      name: flags.name,
      keep: numberFlag(flags, "keep", "--keep"),
      olderThan: flags["older-than"],
    });
    if (flags.json) return { json: result };
    const moved = result.archive ? ` → ${result.archive}` : "";
    return {
      text: `Compacted ${result.name}: kept ${result.kept}, archived ${result.archived}${moved}`,
    };
  },

  async "memory-remove"({ positional, flags }) {
    const dir = zoneOf("memory", positional[0]);
    const match = requireFlag(flags, "match", "literal text identifying entries to delete");
    const name = flags.name || api.DEFAULT_MEMORY_NOTE;
    const result = await api.removeMemoryEntries(dir, name, match);
    if (flags.json) return { json: result };
    const noun = result.removed === 1 ? "entry" : "entries";
    return { text: `Removed ${result.removed} ${noun} from ${result.name}` };
  },
};

// Split a typed command line into argv tokens, honoring double quotes
// (used by the interactive window, where users type commands freely).
function splitLine(line) {
  const tokens = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === " " && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

// Commands that accept the file name as a second positional argument,
// e.g. `recall C:\notes session.md` instead of `--name session.md`.
const NAME_POSITIONAL_COMMANDS = new Set([
  "remember",
  "recall",
  "write",
  "edit",
  "forget",
  "memory-add",
  "memory-recall",
  "memory-update",
  "memory-compact",
  "memory-remove",
]);

// One-line usage per command, appended to errors so the window always shows
// a concrete hint (instead of a bare "missing --name" message).
const USAGE_LINES = {
  list: "list [dir]",
  remember: 'remember [dir] <file> --content "text" | --file <path>',
  recall: "recall [dir] <file> [--tail N] [--compact]",
  write: "write [dir] <file> (--content | --file <path>) [--title/--tags/--type]",
  edit: 'edit [dir] <file> --old "text" [--new "text"] [--all]',
  search: "search [dir] <query words...> [--limit N]",
  forget: "forget [dir] <file>",
  context: "context [dir] [--focus text] [--notes a.md,b.md] [--memory dir]",
  "memory-add":
    "memory-add [dir] (--content | --file <path>) [--name file] [--tags a,b] [--type t]",
  "memory-recall": "memory-recall [dir] [--query words] [--name file] [--limit N] [--chars N]",
  "memory-update": "memory-update [dir] [--name file] [--summary text] [--content | --file]",
  "memory-compact": "memory-compact [dir] [--name file] [--keep N | --older-than date]",
  "memory-remove": 'memory-remove [dir] --match "text" [--name file]',
};

// Execute one argv list and print its outcome (used by both the one-shot
// command line and each line typed into the interactive window).
async function runOnce(argv) {
  if (argv.some((token) => token === "--help" || token === "-h" || token === "help")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const first = argv[0];
  if (first === undefined) return;
  // Legacy launcher form: a single bare argument was the notes directory.
  if (!first.startsWith("--") && !COMMANDS.has(first) && argv.length === 1) {
    const notes = await api.listNotes(api.zoneRoot("writing", process.cwd(), first));
    process.stdout.write(`Notes in ${first} (${notes.length}):\n`);
    for (const note of notes) {
      process.stdout.write(`- ${note.name}${note.title ? ` — ${note.title}` : ""}\n`);
    }
    return;
  }
  if (!COMMANDS.has(first)) {
    throw new Error(`unknown command: ${first}\n${HELP}`);
  }
  const { positional, flags } = parseArgs(argv.slice(1));
  const rest = positional.slice(1);
  if (first === "search") {
    // Query words may be typed right after the directory.
    if (flags.query === undefined && rest.length > 0) flags.query = rest.join(" ");
  } else {
    if (rest.length > 1) {
      throw new Error(
        `unexpected extra argument: ${rest[1]} — only [dir] and one file name may be ` +
          `positional; quote multi-word flag values, e.g. --content "decided: pnpm"`,
      );
    }
    if (rest.length === 1) {
      if (flags.name !== undefined) {
        throw new Error(`file given twice: positional ${rest[0]} and --name ${flags.name}`);
      }
      if (!NAME_POSITIONAL_COMMANDS.has(first)) {
        throw new Error(
          `unexpected extra argument: ${rest[0]} — this command takes no positional file name`,
        );
      }
      flags.name = rest[0];
    }
  }
  const handler = handlers[first];
  try {
    const outcome = await handler({ positional, flags });
    if (outcome.json !== undefined && flags.json) {
      process.stdout.write(`${JSON.stringify(outcome.json, null, 2)}\n`);
    } else if (outcome.text !== undefined) {
      process.stdout.write(`${outcome.text}\n`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}\nusage: ${USAGE_LINES[first] ?? "run.bat help"}`, { cause: error });
  }
}

// Interactive window (double-click run.bat / run.command with no arguments):
// a persistent prompt where commands can be typed one after another.
async function interactive() {
  const { createInterface } = await import("node:readline/promises");
  const isTty = Boolean(process.stdin.isTTY);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write(`${HELP}\n\n`);
  if (isTty)
    process.stdout.write('Type a command — or "exit"/"quit" to close. (Example: list C:\\notes)\n');
  if (isTty) rl.prompt();
  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (line) {
      const lower = line.toLowerCase();
      if (lower === "exit" || lower === "quit" || lower === "q") break;
      const tokens = splitLine(line);
      const dashContent = tokens.findIndex(
        (token, index) => token === "--content" && tokens[index + 1] === "-",
      );
      if (dashContent >= 0) {
        process.stderr.write(
          `${NAME}: --content - reads stdin, which the interactive prompt owns — ` +
            `pass --content "text" or --file <path>\n`,
        );
      } else {
        try {
          await runOnce(tokens);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          process.stderr.write(`${NAME}: ${reason}\n`);
        }
      }
    }
    if (isTty) rl.prompt();
  }
  rl.close();
  if (isTty) process.stdout.write("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) return interactive();
  await runOnce(argv);
}

try {
  await main();
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${NAME}: ${reason}\n`);
  process.exitCode = 1;
}
