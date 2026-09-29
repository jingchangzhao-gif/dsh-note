// Narrowing a zone listing for free: by tag, by type, and by what changed
// lately — "what did I touch since yesterday?" is a cheap question to answer
// from the file system, and a much cheaper one than reading notes to find out.
//
// "Changed" means the file's modification time, not the `updated` front matter
// field: dsh-note maintains `updated` on its own writes, but an edit made in
// another editor moves only the mtime. Files are stat'ed only when a filter
// or sort needs it, so a plain listing costs exactly what it did before.

import { promises as fs } from "node:fs";
import { parseTagsList } from "./frontmatter";
import { clampInt } from "./memory";
import type { NoteFile } from "./notes";

export interface NoteFilter {
  /** comma separated; a note matches when it carries any of them (any case) */
  tags?: string;
  /** exact front matter type */
  type?: string;
  /** only notes modified at/after this date (anything Date can parse) */
  since?: string;
  /** "name" (default) or "recent" (newest modification first) */
  sort?: "name" | "recent";
  /** max notes returned (1–1000) */
  limit?: number;
}

export interface FilteredNote extends NoteFile {
  /** ISO modification time, present when `since` or `sort: "recent"` was used */
  modified?: string;
}

/** Apply a filter to a zone listing (listNotes order is kept for sort "name"). */
export async function filterNotes(
  notes: readonly NoteFile[],
  filter: NoteFilter = {},
): Promise<FilteredNote[]> {
  const sort = filter.sort ?? "name";
  if (sort !== "name" && sort !== "recent") throw new Error('sort must be "name" or "recent".');
  let sinceMs: number | undefined;
  if (filter.since !== undefined && filter.since !== "") {
    sinceMs = Date.parse(filter.since);
    if (Number.isNaN(sinceMs)) {
      throw new Error(`since must be a parseable date, got: ${filter.since}`);
    }
  }
  const wantTags = parseTagsList(filter.tags).map((tag) => tag.toLowerCase());
  let out: FilteredNote[] = notes.filter((note) => {
    if (filter.type && note.meta.type !== filter.type) return false;
    if (wantTags.length === 0) return true;
    const tags = parseTagsList(note.meta.tags).map((tag) => tag.toLowerCase());
    return wantTags.some((tag) => tags.includes(tag));
  });
  if (sinceMs !== undefined || sort === "recent") {
    const stamped: (FilteredNote & { ms: number })[] = [];
    for (const note of out) {
      try {
        const { mtimeMs } = await fs.stat(note.path);
        stamped.push({ ...note, modified: new Date(mtimeMs).toISOString(), ms: mtimeMs });
      } catch {
        // Gone since it was listed: nothing to report about it.
      }
    }
    const kept = stamped.filter((note) => sinceMs === undefined || note.ms >= sinceMs);
    if (sort === "recent") kept.sort((a, b) => b.ms - a.ms);
    out = kept.map(({ ms: _ms, ...note }) => note);
  }
  if (filter.limit !== undefined) out = out.slice(0, clampInt(filter.limit, out.length, 1, 1000));
  return out;
}
