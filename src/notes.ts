// Markdown memory filesystem operations for the dsh agent.
// Pure node:fs — no network, no third-party deps.

import { promises as fs } from "node:fs";
import { basename, join, resolve, isAbsolute } from "node:path";

export interface NoteFile {
  name: string; // basename incl. extension
  path: string;
  title?: string; // first "# " heading, if present
}

export const EXTENSIONS = [".md", ".markdown", ".txt"] as const;

export function resolveMemoryDir(cwd: string | undefined, requestedDir?: string): string {
  const base =
    requestedDir && isAbsolute(requestedDir)
      ? requestedDir
      : join(cwd ?? process.cwd(), requestedDir ?? "notes");
  return resolve(base);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function listNotes(dir: string): Promise<NoteFile[]> {
  await ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((e) => {
      if (!e.isFile()) return false;
      const ext = e.name.slice(e.name.lastIndexOf(".")).toLowerCase();
      return (EXTENSIONS as readonly string[]).includes(ext);
    })
    .map((e) => e.name)
    .sort();
  const out: NoteFile[] = [];
  for (const name of names) {
    const path = join(dir, name);
    const text = await fs.readFile(path, "utf8");
    const m = text.match(/^#\s+(.+)$/m);
    out.push({ name, path, title: m?.[1]?.trim() });
  }
  return out;
}

export async function readNote(dir: string, name: string, tail?: number): Promise<string> {
  const path = join(dir, basename(name));
  const text = await fs.readFile(path, "utf8");
  if (tail == null) return text;
  const chars = Math.min(Math.max(1, Math.round(tail)), 100_000);
  return text.length <= chars ? text : `…${text.slice(-chars)}`;
}

export async function appendNote(
  dir: string,
  name: string,
  content: string,
): Promise<{ name: string; path: string }> {
  await ensureDir(dir);
  const path = join(dir, basename(name));
  let existing = "";
  try {
    existing = await fs.readFile(path, "utf8");
  } catch {
    /* new note */
  }
  const next = existing
    ? existing.trimEnd() + "\n\n---\n\n" + content.trim()
    : content.trim();
  await fs.writeFile(path, next + "\n", "utf8");
  return { name: basename(name), path };
}

export async function deleteNote(dir: string, name: string): Promise<boolean> {
  const path = join(dir, basename(name));
  try {
    await fs.unlink(path);
    return true;
  } catch {
    return false;
  }
}
