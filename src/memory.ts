// Long-term memory bank for dsh-note: per-topic files whose body is a list of
// entries headed by "## <ISO timestamp> [title]". Everything here is free
// local file work — no network, no model, no third-party deps.
//
// Recall follows the token-saving rules:
//   * by default it returns only the recent TAIL of the bank — bounded by
//     `limit` entries and a `chars` budget, never "everything";
//   * `query`/`tags`/`type` narrow it to the small relevant chunk;
//   * files marked `type: archive` (see compactMemory) are never returned.

import { promises as fs } from "node:fs";
import { basename, dirname } from "node:path";
import {
  formatTagsList,
  nowIso,
  parseFrontMatter,
  parseTagsList,
  withFrontMatter,
} from "./frontmatter";
import type { FrontMeta } from "./frontmatter";
import { ARCHIVE_MARK, ARCHIVE_TYPE, ensureDir, isArchive, listNotes, notePath, tokenize } from "./notes";

export const DEFAULT_MEMORY_NOTE = "memory.md";

export interface MemoryEntry {
  /** ISO timestamp token from the entry heading, when it looked like a date */
  when: string | undefined;
  /** Date.parse(when), or 0 when undated */
  whenMs: number;
  /** raw entry text, including its "## " heading line */
  text: string;
}

export interface ParsedMemory {
  /** text before the first entry heading (preserved through compaction) */
  preamble: string;
  entries: MemoryEntry[];
}

export interface AddMemoryOptions {
  name?: string;
  title?: string;
  tags?: string;
  type?: string;
  when?: string;
}

export interface RecallOptions {
  /** single topic file; without it every non-archive bank file is searched */
  name?: string;
  /** keywords: an entry must contain every word (plain substring match) */
  query?: string;
  /** comma separated; a file matches when it carries any of these tags */
  tags?: string;
  /** only files whose front matter type equals this value */
  type?: string;
  /** only entries at/after this date (anything Date can parse) */
  newerThan?: string;
  /** only entries at/before this date */
  olderThan?: string;
  /** max entries to return, newest first (default 10, cap 100) */
  limit?: number;
  /** total character budget for the reply (default 4000) */
  chars?: number;
}

export interface RecallResult {
  content: string;
  files: number;
  /** true when more matches existed but were cut by limit/chars (tail kept) */
  truncated: boolean;
}

export interface CompactOptions {
  name?: string;
  /** keep only the newest N entries (default 20) */
  keep?: number;
  /** alternative: archive everything older than this date */
  olderThan?: string;
}

export interface CompactResult {
  name: string;
  path: string;
  kept: number;
  archived: number;
  /** name of the archive file entries were moved to ("" when nothing moved) */
  archive: string;
}

const ENTRY_HEADING_RE = /^##[ \t]+/gm;
const DATE_START_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/;

function parseDateOrThrow(value: string | undefined, label: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`${label} must be a parseable date, got: ${value}`);
  return ms;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

/** Split a memory file body into preamble + chronological entry blocks. */
export function parseMemory(text: string): ParsedMemory {
  const matches = Array.from(text.matchAll(ENTRY_HEADING_RE));
  if (matches.length === 0) return { preamble: text.trim(), entries: [] };
  const preamble = text.slice(0, matches[0].index).trim();
  const entries: MemoryEntry[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const block = text.slice(start, end).trim();
    if (block) entries.push(entryFromBlock(block));
  }
  return { preamble, entries };
}

function entryFromBlock(block: string): MemoryEntry {
  const newline = block.indexOf("\n");
  const headingLine = (newline < 0 ? block : block.slice(0, newline))
    .replace(/^##[ \t]+/, "")
    .trim();
  const firstToken = headingLine.split(/\s+/)[0] ?? "";
  const whenMs =
    DATE_START_RE.test(firstToken) && !Number.isNaN(Date.parse(firstToken))
      ? Date.parse(firstToken)
      : 0;
  return { when: whenMs ? firstToken : undefined, whenMs, text: block };
}

async function ensureMemoryNote(
  zoneDir: string,
  name: string,
  patch: FrontMeta,
): Promise<{ path: string }> {
  const path = notePath(zoneDir, name);
  try {
    await fs.access(path);
    return { path };
  } catch {
    /* create below */
  }
  const stem = basename(path).replace(/\.(?:md|markdown|txt)$/i, "");
  const meta: FrontMeta = {
    title: stem,
    type: "memory",
    created: nowIso(),
    updated: nowIso(),
    ...patch,
  };
  await ensureDir(dirname(path));
  await fs.writeFile(path, withFrontMatter(meta, ""), "utf8");
  return { path };
}

/** Refresh a file's `updated` front matter field after content changes. */
async function touchUpdated(path: string): Promise<void> {
  const raw = await fs.readFile(path, "utf8");
  const fm = parseFrontMatter(raw);
  if (!fm.hasFrontMatter) return;
  await fs.writeFile(path, withFrontMatter({ ...fm.meta, updated: nowIso() }, fm.body), "utf8");
}

/** Append one timestamped entry to a memory file (creating it when missing). */
export async function addMemoryEntry(
  zoneDir: string,
  content: string,
  options: AddMemoryOptions = {},
): Promise<{ name: string; path: string }> {
  const body = content.trim();
  if (!body) throw new Error("Content to remember is required.");
  const name = options.name?.trim() || DEFAULT_MEMORY_NOTE;
  const patch: FrontMeta = {};
  if (options.title) patch.title = options.title.trim();
  if (options.tags) patch.tags = formatTagsList(parseTagsList(options.tags));
  if (options.type) patch.type = options.type.trim();
  const { path } = await ensureMemoryNote(zoneDir, name, patch);
  const when = options.when ?? nowIso();
  const block = `## ${when}${options.title ? ` — ${options.title}` : ""}\n\n${body}`;
  await fs.appendFile(path, `\n${block}\n`, "utf8");
  await touchUpdated(path);
  return { name, path };
}

/**
 * Recall the small relevant chunk of the memory bank: newest entries first,
 * bounded by limit/chars. When nothing narrows the search, this is just the
 * recent tail of the bank (never the whole history).
 */
export async function recallMemory(
  zoneDir: string,
  options: RecallOptions = {},
): Promise<RecallResult> {
  const words = tokenize(options.query ?? "");
  const wantTags = parseTagsList(options.tags);
  const newerMs = parseDateOrThrow(options.newerThan, "newerThan");
  const olderMs = parseDateOrThrow(options.olderThan, "olderThan");
  const limit = clampInt(options.limit, 10, 1, 100);
  const budget = clampInt(options.chars, 4000, 200, 100_000);
  const wantName = options.name?.trim();
  const pool = wantName
    ? [{ name: wantName, path: notePath(zoneDir, wantName) }]
    : (await listNotes(zoneDir)).filter((file) => !isArchive(file.name, file.meta));

  const sections: string[] = [];
  let files = 0;
  let used = 0;
  let truncated = false;
  let acceptedTotal = 0;
  for (const file of pool) {
    let raw = "";
    try {
      raw = await fs.readFile(file.path, "utf8");
    } catch {
      continue; // requested file does not exist (yet)
    }
    const fm = parseFrontMatter(raw);
    if (isArchive(file.name, fm.meta)) continue;
    if (wantTags.length > 0 && !wantTags.some((tag) => parseTagsList(fm.meta.tags).includes(tag))) {
      continue;
    }
    if (options.type && fm.meta.type !== options.type) continue;
    const parsed = parseMemory(fm.body);
    const matched: MemoryEntry[] = [];
    for (const entry of parsed.entries) {
      if (newerMs !== undefined && entry.whenMs < newerMs) continue;
      if (olderMs !== undefined && entry.whenMs > olderMs) continue;
      if (words.length > 0) {
        const lower = entry.text.toLowerCase();
        if (!words.every((word) => lower.includes(word))) continue;
      }
      matched.push(entry);
    }
    if (matched.length === 0) continue;
    matched.sort((a, b) => b.whenMs - a.whenMs || b.text.localeCompare(a.text));
    const headerLines = [`# ${fm.meta.title?.trim() || file.name}`];
    const tagList = parseTagsList(fm.meta.tags);
    if (tagList.length > 0) headerLines.push(`tags: ${tagList.join(", ")}`);
    if (fm.meta.type && fm.meta.type !== "memory") headerLines.push(`type: ${fm.meta.type}`);
    const header = headerLines.join("\n");
    let bodyText = "";
    for (const entry of matched) {
      if (acceptedTotal >= limit) {
        truncated = true;
        break;
      }
      if (used + bodyText.length + entry.text.length > budget) {
        truncated = true;
        break;
      }
      bodyText += `${bodyText ? "\n" : ""}${entry.text}`;
      acceptedTotal += 1;
    }
    if (!bodyText) continue;
    sections.push(`${header}\n${bodyText}`);
    files += 1;
    used += header.length + bodyText.length + 1;
    if (acceptedTotal >= limit) {
      truncated = true;
      break;
    }
  }
  return { content: sections.join("\n"), files, truncated };
}

/** Merge `patch` fields into a memory file's front matter. */
export async function updateMemoryMeta(
  zoneDir: string,
  name: string,
  patch: FrontMeta,
): Promise<{ name: string; changed: boolean; meta: FrontMeta }> {
  const path = notePath(zoneDir, name);
  let raw = "";
  try {
    raw = await fs.readFile(path, "utf8");
  } catch {
    throw new Error(`Memory note not found: ${name}`);
  }
  const fm = parseFrontMatter(raw);
  const next: FrontMeta = { ...fm.meta, ...patch, updated: nowIso() };
  const changed = JSON.stringify(fm.meta) !== JSON.stringify(next);
  await fs.writeFile(path, withFrontMatter(next, fm.body), "utf8");
  return { name: basename(path), changed, meta: next };
}

/**
 * Compact a memory file for free: move its older entries (everything beyond
 * the newest `keep`, or everything older than `olderThan`) into a sibling
 * `*.archive.md` file. The active file keeps its front matter summary, so a
 * later `note_recall`/`memory_recall` stays small. No model involved.
 */
export async function compactMemory(
  zoneDir: string,
  options: CompactOptions = {},
): Promise<CompactResult> {
  const name = options.name?.trim() || DEFAULT_MEMORY_NOTE;
  const path = notePath(zoneDir, name);
  const raw = await fs.readFile(path, "utf8");
  const fm = parseFrontMatter(raw);
  const parsed = parseMemory(fm.body);
  let removed: MemoryEntry[] = [];
  if (options.olderThan !== undefined) {
    const cutoff = parseDateOrThrow(options.olderThan, "olderThan");
    if (cutoff !== undefined) {
      removed = parsed.entries.filter((entry) => entry.whenMs > 0 && entry.whenMs < cutoff);
    }
  } else {
    const keep = clampInt(options.keep, 20, 1, 10_000);
    removed = parsed.entries.slice(0, Math.max(0, parsed.entries.length - keep));
  }
  if (removed.length === 0) {
    return { name, path, kept: parsed.entries.length, archived: 0, archive: "" };
  }
  const keptEntries = parsed.entries.filter((entry) => !removed.includes(entry));
  const stem = basename(path).replace(/\.(?:md|markdown|txt)$/i, "");
  const archive = `${stem}${ARCHIVE_MARK}md`;
  const archivePath = notePath(zoneDir, archive);
  let archiveRaw = "";
  try {
    archiveRaw = await fs.readFile(archivePath, "utf8");
  } catch {
    /* new archive */
  }
  const archiveFm = parseFrontMatter(archiveRaw);
  const existing = archiveFm.hasFrontMatter ? archiveFm.meta : {};
  const archiveMeta: FrontMeta = {
    ...existing,
    title: existing.title ?? `${stem} (archive)`,
    type: ARCHIVE_TYPE,
    created: existing.created ?? nowIso(),
    updated: nowIso(),
  };
  const removedText = removed.map((entry) => entry.text).join("\n\n");
  const archiveBody =
    archiveFm.body.length > 0 ? `${archiveFm.body.trimEnd()}\n\n${removedText}` : removedText;
  await fs.writeFile(archivePath, withFrontMatter(archiveMeta, archiveBody), "utf8");
  const keptText = keptEntries.map((entry) => entry.text).join("\n\n");
  const body = [parsed.preamble, keptText].filter((part) => part.length > 0).join("\n\n");
  await fs.writeFile(path, withFrontMatter({ ...fm.meta, updated: nowIso() }, body), "utf8");
  return { name, path, kept: keptEntries.length, archived: removed.length, archive };
}

/** Delete every entry whose text contains `match` (deliberate discard). */
export async function removeMemoryEntries(
  zoneDir: string,
  name: string,
  match: string,
): Promise<{ name: string; removed: number }> {
  const needle = match.trim();
  if (!needle) throw new Error("A match text is required.");
  const path = notePath(zoneDir, name);
  const raw = await fs.readFile(path, "utf8");
  const fm = parseFrontMatter(raw);
  const parsed = parseMemory(fm.body);
  const keptEntries = parsed.entries.filter((entry) => !entry.text.includes(needle));
  const removed = parsed.entries.length - keptEntries.length;
  if (removed === 0) return { name: basename(path), removed };
  const meta = { ...fm.meta, updated: nowIso() };
  const body = [parsed.preamble, keptEntries.map((entry) => entry.text).join("\n\n")]
    .filter((part) => part.length > 0)
    .join("\n\n");
  await fs.writeFile(path, withFrontMatter(meta, body), "utf8");
  return { name: basename(path), removed };
}
