// Minimal, dependency-free front matter for dsh-note files.
//
// Format: an optional leading block delimited by `---` lines, holding
// `key: value` lines. Values are plain strings; list-like fields (tags) use
// comma separation. Everything after the closing `---` is the note body.
// Parsing is local file work — free, no model involved.

export type FrontMeta = Record<string, string>;

export interface ParsedFrontMatter {
  /** true when the text began with a well-formed `---` block */
  hasFrontMatter: boolean;
  meta: FrontMeta;
  /** note text below the front matter */
  body: string;
}

export const FRONT_MATTER_MARK = "---";

const KEY_VALUE_RE = /^([A-Za-z0-9_-]+):\s*(.*)$/;

/** Parse the leading front matter of a file's text, if present. */
export function parseFrontMatter(text: string): ParsedFrontMatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== FRONT_MATTER_MARK) {
    return { hasFrontMatter: false, meta: {}, body: text };
  }
  const meta: FrontMeta = {};
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === FRONT_MATTER_MARK) {
      close = i;
      break;
    }
    const match = KEY_VALUE_RE.exec(line);
    if (match) meta[match[1]] = match[2].trim();
    // malformed lines inside the block are skipped
  }
  if (close < 0) {
    // An opening mark without a closing one is not (valid) front matter.
    return { hasFrontMatter: false, meta: {}, body: text };
  }
  return {
    hasFrontMatter: true,
    meta,
    body: lines
      .slice(close + 1)
      .join("\n")
      .replace(/\n+$/, ""),
  };
}

/** Serialize meta into a front matter block ("" when empty). Ends with "\n". */
export function renderFrontMatter(meta: FrontMeta): string {
  const keys = Object.keys(meta);
  if (keys.length === 0) return "";
  const block = keys.map((key) => `${key}: ${meta[key]}`).join("\n");
  return `${FRONT_MATTER_MARK}\n${block}\n${FRONT_MATTER_MARK}\n`;
}

/**
 * Combine meta + body into canonical file text.
 * Leading blank lines of the body are dropped and a single trailing newline
 * is guaranteed, so round-tripping through parseFrontMatter is stable.
 */
export function withFrontMatter(meta: FrontMeta, body: string): string {
  const head = renderFrontMatter(meta);
  if (head === "") return body.replace(/\s+$/, "");
  const content = body.replace(/^\n+/, "").replace(/\s+$/, "");
  return content === "" ? head : `${head}${content}\n`;
}

/** Parse a comma separated tags value into a trimmed, deduped list. */
export function parseTagsList(value: string | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of value.split(",")) {
    const clean = tag.trim();
    if (clean.length === 0 || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

/** Join tags into a canonical comma separated value (deduped). */
export function formatTagsList(tags: readonly string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const clean = tag.trim();
    if (clean.length === 0 || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out.join(", ");
}

/** Current time as an ISO string, used for created/updated fields. */
export function nowIso(): string {
  return new Date().toISOString();
}
