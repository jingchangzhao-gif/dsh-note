// One part of a note instead of all of it: the heading outline (a cheap map of
// a long note) and a single section by its heading. Reading "## Setup" rather
// than the whole file is the token saving; like everything here it is plain
// local text work, no model involved.
//
// A section is its ATX heading line plus everything up to the next heading of
// the same or a higher level, so it carries its subsections. Headings inside
// fenced code blocks are code (a shell comment), not structure.

export interface Heading {
  /** 1 for "#", 6 for "######" */
  level: number;
  /** heading text without the #s (closing #s dropped too) */
  text: string;
  /** 1-based line number in the body */
  line: number;
  /** length of the whole section, heading and subsections included */
  chars: number;
}

export interface Section {
  heading: Heading;
  /** the section text, heading line first, trailing blank lines trimmed */
  text: string;
}

// Up to three spaces of indent, 1–6 #s, a space, the text, optional closing #s.
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

interface Located extends Heading {
  /** index of the heading line, and of the first line after the section */
  start: number;
  end: number;
}

function locate(body: string): { lines: string[]; headings: Located[] } {
  const lines = body.split(/\r?\n/);
  const found: { level: number; text: string; start: number }[] = [];
  let fenced = false;
  lines.forEach((line, index) => {
    const start = line.trimStart();
    if (start.startsWith("```") || start.startsWith("~~~")) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const match = HEADING_RE.exec(line);
    if (match && match[2].trim() !== "") {
      found.push({ level: match[1].length, text: match[2].trim(), start: index });
    }
  });
  const headings = found.map((heading, i) => {
    const next = found.slice(i + 1).find((later) => later.level <= heading.level);
    const end = next ? next.start : lines.length;
    const text = sectionText(lines, heading.start, end);
    return { ...heading, line: heading.start + 1, end, chars: text.length };
  });
  return { lines, headings };
}

function sectionText(lines: readonly string[], start: number, end: number): string {
  return lines.slice(start, end).join("\n").replace(/\s+$/, "");
}

/** The note's headings in order, each with the size of its section. */
export function noteOutline(body: string): Heading[] {
  return locate(body).headings.map(({ level, text, line, chars }) => ({
    level,
    text,
    line,
    chars,
  }));
}

/** The outline as indented heading lines, e.g. "  ## Setup (240 chars)". */
export function renderOutline(headings: readonly Heading[]): string {
  if (headings.length === 0) return "(no headings)";
  const top = Math.min(...headings.map((heading) => heading.level));
  return headings
    .map(
      (heading) =>
        `${"  ".repeat(heading.level - top)}${"#".repeat(heading.level)} ${heading.text} (${heading.chars} chars)`,
    )
    .join("\n");
}

/** Normalize a requested heading: leading #s, spacing and case don't matter. */
function headingKey(value: string): string {
  return value
    .replace(/^\s*#+\s*/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Find one section by its heading. A missing heading names the ones that exist
 * (so the caller can correct itself without another round trip), and a heading
 * that appears twice is refused rather than guessed.
 */
export function findSection(body: string, heading: string): Section {
  const { lines, match } = matchSection(body, heading);
  const { start, end, level, text, line, chars } = match;
  return { heading: { level, text, line, chars }, text: sectionText(lines, start, end) };
}

function matchSection(body: string, heading: string): { lines: string[]; match: Located } {
  const { lines, headings } = locate(body);
  const key = headingKey(heading);
  const matches = headings.filter((candidate) => headingKey(candidate.text) === key);
  if (matches.length === 0) {
    const known =
      headings.length > 0
        ? `headings: ${headings.map((candidate) => candidate.text).join(", ")}`
        : "this note has no headings";
    throw new Error(`Section not found: ${heading.trim()} (${known})`);
  }
  if (matches.length > 1) {
    const at = matches.map((match) => match.line).join(", ");
    throw new Error(
      `Section is ambiguous: "${heading.trim()}" matches ${matches.length} headings (lines ${at})`,
    );
  }
  return { lines, match: matches[0] };
}

export type SectionMode = "replace" | "append" | "prepend";

/** Read a caller's mode (tool argument or CLI flag); replace when unset. */
export function sectionMode(value: unknown): SectionMode {
  if (value === undefined) return "replace";
  if (value === "replace" || value === "append" || value === "prepend") return value;
  throw new Error("mode must be replace, append or prepend.");
}

/**
 * Rewrite one section in place: `replace` swaps everything under the heading
 * (subsections included — the same span findSection returns), `append` adds
 * text at the section's end, `prepend` right under its heading. The heading
 * line and every other section are kept as they were; blank lines around the
 * changed section are normalized to one.
 */
export function patchSection(
  body: string,
  heading: string,
  content: string,
  mode: SectionMode,
): string {
  const added = content.trim();
  if (mode !== "replace" && added === "") throw new Error(`Text to ${mode} is required.`);
  const { lines, match } = matchSection(body, heading);
  const headingLine = lines[match.start];
  const under = sectionText(lines, match.start + 1, match.end).trim();
  let parts: string[];
  if (mode === "replace") parts = [headingLine, added];
  else if (mode === "append") parts = [headingLine, under, added];
  else parts = [headingLine, added, under];
  const section = parts.filter((part) => part !== "").join("\n\n");
  const before = sectionText(lines, 0, match.start);
  const after = sectionText(lines, match.end, lines.length);
  return [before, section, after].filter((part) => part !== "").join("\n\n");
}
