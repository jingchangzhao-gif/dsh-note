// Local, token-free filesystem layer for dsh-note.
// Pure node:fs — no network, no third-party deps. Every operation in this
// module is free; the only thing that costs tokens is the model thinking
// afterwards, and this layer exists to keep that thinking small:
// two separate zones (writing notes vs. long-term memory), front matter on
// files, full update/edit instead of append-only, and local keyword search.

import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { FRONT_MATTER_MARK, nowIso, parseFrontMatter, withFrontMatter } from "./frontmatter";
import type { FrontMeta, ParsedFrontMatter } from "./frontmatter";
import { findSection, patchSection } from "./sections";
import { notFoundHint } from "./suggest";
import type { SectionMode } from "./sections";

export type Zone = "writing" | "memory";

export interface NoteFile {
  /** file name, zone-relative ("/"-separated when nested) */
  name: string;
  path: string;
  /** meta title, else first "# " heading */
  title?: string;
  meta: FrontMeta;
}

export interface NoteContent {
  name: string;
  path: string;
  meta: FrontMeta;
  /** text below the front matter */
  body: string;
  /** full file text (front matter included) */
  raw: string;
}

export interface SearchHit {
  name: string;
  path: string;
  title?: string;
  meta: FrontMeta;
  snippet: string;
  score: number;
}

export interface SearchOptions {
  limit?: number;
  snippetChars?: number;
}

export interface EditOp {
  /** literal text to find (in the body only, never inside front matter) */
  old: string;
  /** replacement; "" deletes the match */
  new: string;
  /** replace every occurrence instead of just the first */
  all?: boolean;
}

export const EXTENSIONS = [".md", ".markdown", ".txt"] as const;

/** Default zone folder names under the session working directory. */
export const DEFAULT_ZONES: Record<Zone, string> = { writing: "notes", memory: "memory" };

/** Marks compacted long-term memory files; they are excluded from recalls. */
export const ARCHIVE_MARK = ".archive.";
export const ARCHIVE_TYPE = "archive";

/** A file is an archive when named *.archive.* or typed archive. */
export function isArchive(name: string, meta: FrontMeta): boolean {
  return meta.type === ARCHIVE_TYPE || name.includes(ARCHIVE_MARK);
}

// Character-budget constants and helpers shared by the recall tools and the CLI
// so the "last N chars" and "compact recent view" rules live in one place.
export const MAX_TEXT_CHARS = 100_000;
export const COMPACT_BUDGET = 800;

/** Clamp a requested character count into the sane [1, MAX_TEXT_CHARS] range. */
export function clampChars(value: number): number {
  return Math.min(Math.max(1, Math.round(value)), MAX_TEXT_CHARS);
}

/** Return the last `chars` characters, elided with a leading ellipsis when cut. */
export function tailText(raw: string, chars: number): string {
  const c = clampChars(chars);
  return raw.length <= c ? raw : `…${raw.slice(-c)}`;
}

/** A short recent view of a body for compact recall (summary already shown). */
export function compactTail(body: string, budget = COMPACT_BUDGET): string {
  return body.length > budget ? `…${body.slice(-budget)}` : body;
}

const HEAD_CHUNK = 16 * 1024;

/** Resolve a zone root from cwd and an optional override directory. */
export function zoneRoot(zone: Zone, cwd: string | undefined, override?: string): string {
  const base =
    override && isAbsolute(override)
      ? override
      : join(cwd ?? process.cwd(), override ?? DEFAULT_ZONES[zone]);
  return resolve(base);
}

/** v0.1-compatible alias: the writing zone under ./notes by default. */
export function resolveMemoryDir(cwd: string | undefined, requestedDir?: string): string {
  return zoneRoot("writing", cwd, requestedDir);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// Temp-file suffix for writeTextFile: never a note extension, so a stray file
// left by a failed rename is invisible to listNotes/searchNotes.
let tempSeq = 0;

/**
 * Write a file in one step: the text lands in a sibling temp file first and is
 * renamed over the target, so a crash or a full disk can never leave a note
 * half-written (rename is atomic on the same filesystem).
 */
export async function writeTextFile(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}-${(tempSeq += 1)}.tmp`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, path);
}

/** Zone-relative, "/"-separated name for an absolute path inside a zone. */
export function zoneRelativeName(zoneDir: string, path: string): string {
  return relative(resolve(zoneDir), path).replace(/\\/g, "/");
}

export function isNoteExt(name: string): boolean {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return (EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Resolve a note name inside a zone dir. Names may contain "/" to address
 * nested files, but can never escape the zone root.
 */
export function notePath(zoneDir: string, name: string): string {
  const cleaned = name.replace(/\\/g, "/");
  if (cleaned === "" || cleaned === ".") throw new Error(`Invalid note name: ${name}`);
  const withExt = isNoteExt(cleaned) ? cleaned : `${cleaned}.md`;
  const root = resolve(zoneDir);
  const target = resolve(join(root, withExt));
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Note name escapes the notes directory: ${name}`);
  }
  return target;
}

/**
 * notePath for a note about to be created or moved: every scan (list, search,
 * stats, map, links) skips dot files and folders, so a name with a segment
 * starting with "." would be written, reported as created, and never seen
 * again. Reading or editing such a note that already exists still works.
 */
export function newNotePath(zoneDir: string, name: string): string {
  const path = notePath(zoneDir, name);
  if (
    zoneRelativeName(zoneDir, path)
      .split("/")
      .some((part) => part.startsWith("."))
  ) {
    throw new Error(
      `Note names cannot start with a dot, in any folder: ${name} (dot files are hidden from every listing and search)`,
    );
  }
  return path;
}

/**
 * The path a create-or-update writer may use: an existing note (even a
 * dot-named one) can be updated, but a new one must be visible (newNotePath).
 */
export async function writableNotePath(zoneDir: string, name: string): Promise<string> {
  const path = notePath(zoneDir, name);
  return (await exists(path)) ? path : newNotePath(zoneDir, name);
}

/** Split query text into lower-case keyword tokens (keeps CJK runs intact). */
export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

export function firstHeading(text: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(text);
  return match?.[1]?.trim();
}

/** Prefer the front matter title, fall back to the first "# " heading. */
export function pickTitle(meta: FrontMeta, bodyText: string): string | undefined {
  const fromMeta = meta.title?.trim();
  return fromMeta || firstHeading(bodyText) || undefined;
}

/** Read up to `max` bytes from the head of a file, decoding UTF-8 safely. */
async function readHead(path: string, max: number = HEAD_CHUNK): Promise<string> {
  const handle = await fs.open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size <= 0) return "";
    const length = Math.min(max, size);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    // A cut may split a multi-byte sequence: retry with up to 3 bytes less.
    for (let cut = 0; cut <= 3; cut += 1) {
      const slice = buffer.subarray(0, length - cut);
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(slice);
      } catch {
        /* try a shorter slice */
      }
    }
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

/**
 * Recursively enumerate note files below a root, sorted, names "/"-separated.
 * Read-only: a missing or unreadable directory yields no files instead of
 * creating the zone (only writers create folders).
 */
async function listFilesRecursive(root: string): Promise<{ name: string; path: string }[]> {
  const found: { name: string; path: string }[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      // An unreadable subdirectory (permissions, macOS TemporaryItems) must not
      // break the whole listing: skip that branch and keep walking the rest.
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) found.push({ name: relative(root, path).replace(/\\/g, "/"), path });
    }
  }
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found;
}

/** Zone-relative names of every note file in a zone (no content read). */
export async function noteNames(zoneDir: string): Promise<string[]> {
  return (await listFilesRecursive(zoneDir))
    .map((file) => file.name)
    .filter((name) => isNoteExt(name));
}

/** Read a file, turning "missing" into a message a user can act on. */
async function readNoteText(zoneDir: string, path: string, name: string): Promise<string> {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    throw new Error(`Note not found: ${name}${notFoundHint(name, await noteNames(zoneDir))}`);
  }
}

async function readParsed(path: string): Promise<ParsedFrontMatter> {
  const raw = await fs.readFile(path, "utf8");
  return parseFrontMatter(raw);
}

async function describeNote(relName: string, path: string): Promise<NoteFile> {
  const head = await readHead(path);
  // The same opening-line test parseFrontMatter applies (a trimmed `---`), so a
  // listing never disagrees with a read about whether a note has front matter.
  const startsWithMark = head.split(/\r?\n/, 1)[0].trim() === FRONT_MATTER_MARK;
  if (!startsWithMark) {
    return { name: relName, path, title: firstHeading(head), meta: {} };
  }
  const fm = parseFrontMatter(head);
  if (fm.hasFrontMatter) {
    return { name: relName, path, title: pickTitle(fm.meta, fm.body), meta: fm.meta };
  }
  // Front matter block longer than the head chunk: read the whole file.
  const full = await readParsed(path);
  return {
    name: relName,
    path,
    title: pickTitle(full.meta, full.body),
    meta: full.meta,
  };
}

/** List note files under a zone dir (recursive, sorted by name). */
export async function listNotes(zoneDir: string): Promise<NoteFile[]> {
  const files = await listFilesRecursive(zoneDir);
  const out: NoteFile[] = [];
  for (const file of files) {
    if (!isNoteExt(file.name)) continue;
    try {
      out.push(await describeNote(file.name, file.path));
    } catch {
      // Unreadable file: skip it rather than failing the whole listing.
    }
  }
  return out;
}

/** Read a note's full raw text (front matter included), v0.1 semantics. */
export async function readNote(zoneDir: string, name: string, tail?: number): Promise<string> {
  const path = notePath(zoneDir, name);
  const raw = await readNoteText(zoneDir, path, name);
  if (tail == null) return raw;
  return tailText(raw, tail);
}

/** Read a note split into meta + body (raw text included). */
export async function readNoteFull(zoneDir: string, name: string): Promise<NoteContent> {
  const path = notePath(zoneDir, name);
  const raw = await readNoteText(zoneDir, path, name);
  const fm = parseFrontMatter(raw);
  return {
    name: zoneRelativeName(zoneDir, path),
    path,
    meta: fm.meta,
    body: fm.body,
    raw,
  };
}

/** Append a content block to a note, creating it when missing. */
export async function appendNote(
  zoneDir: string,
  name: string,
  content: string,
): Promise<{ name: string; path: string }> {
  const path = await writableNotePath(zoneDir, name);
  await ensureDir(dirname(path));
  let raw = "";
  let fm: ParsedFrontMatter | undefined;
  try {
    raw = await fs.readFile(path, "utf8");
    fm = parseFrontMatter(raw);
  } catch {
    /* new note */
  }
  const base = fm?.hasFrontMatter ? fm.body : raw;
  const nextBody = base ? `${base.trimEnd()}\n\n---\n\n${content.trim()}` : content.trim();
  if (fm?.hasFrontMatter) {
    const meta = { ...fm.meta, updated: nowIso() };
    await writeTextFile(path, withFrontMatter(meta, nextBody, fm.lists));
  } else {
    await writeTextFile(path, `${nextBody.trimEnd()}\n`);
  }
  return { name: zoneRelativeName(zoneDir, path), path };
}

export interface WriteResult {
  name: string;
  path: string;
  created: boolean;
  meta: FrontMeta;
}

export interface WriteOptions {
  /** refuse instead of replacing a note that already exists */
  createOnly?: boolean;
}

/**
 * Fully replace a note's body (creating the note when missing).
 * `patch` fields merge into the file's front matter when present; existing
 * meta keys not mentioned are preserved. `updated` is maintained for free.
 * With `createOnly`, an existing note is left alone and the write refused —
 * a replace is only reported (created: false) after the old body is gone.
 */
export async function writeNote(
  zoneDir: string,
  name: string,
  body: string,
  patch: FrontMeta = {},
  options: WriteOptions = {},
): Promise<WriteResult> {
  const path = await writableNotePath(zoneDir, name);
  let existing: ParsedFrontMatter | undefined;
  try {
    existing = await readParsed(path);
  } catch {
    /* new note */
  }
  if (existing && options.createOnly) {
    throw new Error(
      `A note already exists: ${zoneRelativeName(zoneDir, path)} (createOnly will not replace it)`,
    );
  }
  await ensureDir(dirname(path));
  const hasMeta =
    Boolean(existing?.hasFrontMatter) || Object.keys(patch).filter((k) => patch[k]).length > 0;
  if (hasMeta) {
    const base = existing?.hasFrontMatter ? existing.meta : {};
    const meta: FrontMeta = { ...base, ...patch };
    meta.updated = nowIso();
    if (!meta.created) meta.created = nowIso();
    await writeTextFile(path, withFrontMatter(meta, body, existing?.lists));
    return { name: zoneRelativeName(zoneDir, path), path, created: !existing, meta };
  }
  await writeTextFile(path, `${body.trimEnd()}\n`);
  return { name: zoneRelativeName(zoneDir, path), path, created: !existing, meta: {} };
}

export interface EditResult {
  name: string;
  path: string;
  changed: boolean;
  edits: number;
}

/**
 * Apply literal text edits to a note's body. Front matter is never matched.
 * With `all` unset only the first occurrence is replaced.
 */
export async function editNote(zoneDir: string, name: string, ops: EditOp[]): Promise<EditResult> {
  if (ops.length === 0) throw new Error("At least one edit operation is required.");
  for (const op of ops) {
    if (!op.old) throw new Error("An edit operation requires a non-empty old text.");
  }
  const path = notePath(zoneDir, name);
  const fm = parseFrontMatter(await readNoteText(zoneDir, path, name));
  let body = fm.body;
  let edits = 0;
  for (const op of ops) {
    if (op.all) {
      const parts = body.split(op.old);
      edits += parts.length - 1;
      body = parts.join(op.new);
    } else {
      const index = body.indexOf(op.old);
      if (index >= 0) {
        edits += 1;
        body = body.slice(0, index) + op.new + body.slice(index + op.old.length);
      }
    }
  }
  const changed = edits > 0;
  if (changed) await writeBody(path, fm, body);
  return { name: zoneRelativeName(zoneDir, path), path, changed, edits };
}

/** Save a new body under the note's front matter, refreshing `updated`. */
async function writeBody(path: string, fm: ParsedFrontMatter, body: string): Promise<void> {
  if (fm.hasFrontMatter) {
    await writeTextFile(path, withFrontMatter({ ...fm.meta, updated: nowIso() }, body, fm.lists));
  } else {
    await writeTextFile(path, `${body.trimEnd()}\n`);
  }
}

export interface SectionEditResult {
  name: string;
  path: string;
  changed: boolean;
  /** the heading as written in the note */
  section: string;
  mode: SectionMode;
}

/**
 * Rewrite one section of a note by its heading (see patchSection): the model
 * names the part to change instead of quoting the old text. Front matter is
 * never touched beyond `updated`.
 */
export async function editSection(
  zoneDir: string,
  name: string,
  heading: string,
  content: string,
  mode: SectionMode = "replace",
): Promise<SectionEditResult> {
  const path = notePath(zoneDir, name);
  const fm = parseFrontMatter(await readNoteText(zoneDir, path, name));
  const section = findSection(fm.body, heading).heading.text;
  const body = patchSection(fm.body, heading, content, mode);
  const changed = body !== fm.body.replace(/\s+$/, "");
  if (changed) await writeBody(path, fm, body);
  return { name: zoneRelativeName(zoneDir, path), path, changed, section, mode };
}

/** Folder inside a zone that note_forget moves notes to (Obsidian uses it too). */
export const TRASH_DIR = ".trash";

/**
 * Move a note into the zone's `.trash/` folder, keeping its relative path, and
 * return where it went (zone-relative), or undefined when there was no note.
 * `.trash` is a dot folder, so every listing, search and stat already skips
 * it; restoring is moving the file back. A name already taken in the trash
 * gets a `-2`, `-3` … suffix instead of being overwritten.
 */
export async function trashNote(zoneDir: string, name: string): Promise<string | undefined> {
  const path = notePath(zoneDir, name);
  if (!(await exists(path))) return undefined;
  const rel = zoneRelativeName(zoneDir, path);
  const dot = rel.lastIndexOf(".");
  let target = join(zoneDir, TRASH_DIR, rel);
  for (let n = 2; await exists(target); n += 1) {
    target = join(zoneDir, TRASH_DIR, `${rel.slice(0, dot)}-${n}${rel.slice(dot)}`);
  }
  await ensureDir(dirname(target));
  await fs.rename(path, target);
  return zoneRelativeName(zoneDir, target);
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/** Delete a note file permanently; reports false when it did not exist. */
export async function deleteNote(zoneDir: string, name: string): Promise<boolean> {
  const path = notePath(zoneDir, name);
  try {
    await fs.unlink(path);
    return true;
  } catch {
    return false;
  }
}

/** Count occurrences of `needle` in `haystack`. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let index = 0;
  for (;;) {
    const at = haystack.indexOf(needle, index);
    if (at < 0) break;
    count += 1;
    index = at + needle.length;
  }
  return count;
}

/** Build a short snippet around the first line containing `needle`. */
export function makeSnippet(text: string, needle: string, maxChars: number): string {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.toLowerCase().includes(needle));
  if (index < 0) return text.slice(0, maxChars);
  const from = Math.max(0, index - 1);
  const to = Math.min(lines.length, index + 2);
  let snippet = lines.slice(from, to).join("\n");
  if (snippet.length > maxChars) snippet = `${snippet.slice(0, maxChars)}…`;
  return snippet;
}

/**
 * Free keyword search over a zone: returns files containing every query word,
 * ranked by total occurrence count, with a small snippet around the first hit.
 * No model, no index to maintain — plain local file work.
 */
export async function searchNotes(
  zoneDir: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchHit[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
  const snippetChars = Math.max(80, options.snippetChars ?? 240);
  const words = tokenize(query);
  if (words.length === 0) return [];
  const files = await listFilesRecursive(zoneDir);
  const hits: SearchHit[] = [];
  for (const file of files) {
    if (!isNoteExt(file.name)) continue;
    let raw = "";
    try {
      raw = await fs.readFile(file.path, "utf8");
    } catch {
      continue; // unreadable file: skip it instead of failing the whole search
    }
    const lower = raw.toLowerCase();
    if (!words.every((word) => lower.includes(word))) continue;
    const fm = parseFrontMatter(raw);
    const score = words.reduce((sum, word) => sum + countOccurrences(lower, word), 0);
    const snippet = makeSnippet(fm.body.length > 0 ? fm.body : raw, words[0], snippetChars);
    hits.push({
      name: file.name,
      path: file.path,
      title: pickTitle(fm.meta, fm.body),
      meta: fm.meta,
      snippet,
      score,
    });
  }
  hits.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return hits.slice(0, limit);
}
