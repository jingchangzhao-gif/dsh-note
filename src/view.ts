// How a note is presented back to a caller — the model through a dsh tool, or
// a person through the CLI. Both surfaces must read a note the same frugal way
// (recent tail, or summary + tail) and hide the same files, so those rules live
// here rather than being written out once per surface. Everything is free
// local work; nothing in this module calls a model.

import type { FrontMeta } from "./frontmatter";
import { clampChars, compactTail, COMPACT_BUDGET, isArchive, tailText } from "./notes";
import type { NoteContent } from "./notes";

export interface RecallView {
  /** what the caller shows the model/user */
  content: string;
  /** true when older text was left out of `content` */
  truncated: boolean;
}

/**
 * Small view of a long note: the `summary` front matter field (the digest the
 * model wrote earlier) plus the recent tail of the body.
 */
export function compactView(full: NoteContent, budget: number = COMPACT_BUDGET): RecallView {
  const body = full.body.trim();
  const recent = compactTail(body, budget);
  const summary = full.meta.summary?.trim();
  return {
    content: summary ? `summary: ${summary}\n\n${recent}` : recent,
    truncated: body.length > budget,
  };
}

/** The last `chars` characters of a note's full text (front matter included). */
export function tailView(full: NoteContent, chars?: number): RecallView {
  const wanted = clampChars(chars ?? 1);
  return { content: tailText(full.raw, wanted), truncated: full.raw.length > wanted };
}

/**
 * Drop archive files unless the caller asked for them. Archives are the cold
 * storage written by memory_compact; showing them by default would undo the
 * token saving the compaction paid for.
 */
export function visibleOnly<T extends { name: string; meta: FrontMeta }>(
  items: readonly T[],
  includeArchives: boolean,
): T[] {
  return includeArchives ? [...items] : items.filter((item) => !isArchive(item.name, item.meta));
}

export const SEARCH_LIMIT_DEFAULT = 10;
export const SEARCH_LIMIT_MAX = 50;

/** Clamp a requested search hit count into the supported range. */
export function clampSearchLimit(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return SEARCH_LIMIT_DEFAULT;
  return Math.max(1, Math.min(Math.round(value), SEARCH_LIMIT_MAX));
}
