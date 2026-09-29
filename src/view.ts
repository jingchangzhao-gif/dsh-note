// How a note is presented back to a caller — the model through a dsh tool, or
// a person through the CLI. Both surfaces must read a note the same frugal way
// (recent tail, or summary + tail) and hide the same files, so those rules live
// here rather than being written out once per surface. Everything is free
// local work; nothing in this module calls a model.

import type { FrontMeta } from "./frontmatter";
import { clampChars, compactTail, COMPACT_BUDGET, isArchive, tailText } from "./notes";
import type { NoteContent } from "./notes";
import { findSection, noteOutline, renderOutline } from "./sections";

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

/** One section of the body by its heading (subsections included). */
export function sectionView(full: NoteContent, heading: string): RecallView {
  const { text } = findSection(full.body, heading);
  return { content: text, truncated: text.length < full.body.trim().length };
}

/** Just the body's headings with their section sizes — a map before a read. */
export function outlineView(full: NoteContent): RecallView {
  return { content: renderOutline(noteOutline(full.body)), truncated: full.body.trim() !== "" };
}

export interface NoteViewOptions {
  tail?: number;
  compact?: boolean;
  section?: string;
  outline?: boolean;
}

/**
 * The view a recall asked for: the full text by default, or exactly one of
 * tail, compact, section or outline. Asking for two would silently drop one,
 * so that is refused.
 */
export function recallView(full: NoteContent, options: NoteViewOptions = {}): RecallView {
  const asked = [
    options.tail !== undefined,
    Boolean(options.compact),
    options.section !== undefined,
    Boolean(options.outline),
  ].filter(Boolean).length;
  if (asked > 1) throw new Error("Ask for one of tail, compact, section or outline, not several.");
  if (options.outline) return outlineView(full);
  if (options.section !== undefined) return sectionView(full, options.section);
  if (options.compact) return compactView(full);
  if (options.tail !== undefined) return tailView(full, options.tail);
  return { content: full.raw, truncated: false };
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
