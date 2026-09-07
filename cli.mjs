#!/usr/bin/env node
// Cross-platform launcher for dsh-note memory.
// Usage: node cli.mjs [notes-directory]
// Runs on Windows and macOS from the same file (built output in lib/).
import { resolveMemoryDir, listNotes } from "./lib/notes.js";

const dir = process.argv[2] ?? "notes";
try {
  const notes = await listNotes(resolveMemoryDir(undefined, dir));
  console.log(`Memory in ${resolveMemoryDir(undefined, dir)} (${notes.length}):`);
  for (const note of notes) {
    console.log(`- ${note.name}${note.title ? ` — ${note.title}` : ""}`);
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`dsh-note: ${reason}`);
  process.exit(1);
}
