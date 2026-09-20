// Links between notes for dsh-note: what a note points at, what points back at
// it, which targets resolve to nothing, and which notes nothing links to.
//
// Two syntaxes are recognised, both already meaningful in a markdown file:
//   [label](decisions.md)   a normal markdown link
//   [[decisions]]           the note-taking wikilink (optionally [[t|label]])
// Targets are zone-relative names, the same convention every other tool uses,
// so `log/today.md` and `[[today]]` (extension added) both work. External URLs,
// in-page anchors, absolute paths and links inside fenced code blocks are not
// links between notes and are ignored.

import { promises as fs } from "node:fs";
import { parseFrontMatter } from "./frontmatter";
import { isArchive, listNotes } from "./notes";

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const MARKDOWN_LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** True when a markdown link target could name a note rather than a URL. */
function isNoteTarget(target: string): boolean {
  if (target === "" || target.startsWith("#") || target.startsWith("/")) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(target); // http:, https:, mailto:, data: …
}

/** Note names a body points at, in file order, duplicates kept for the caller. */
export function extractLinks(body: string): string[] {
  const targets: string[] = [];
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    const start = line.trimStart();
    if (start.startsWith("```") || start.startsWith("~~~")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(WIKILINK_RE)) {
      const target = match[1].split("#")[0].trim();
      if (target) targets.push(target);
    }
    for (const match of line.matchAll(MARKDOWN_LINK_RE)) {
      const target = match[1].trim();
      if (isNoteTarget(target)) targets.push(target.split("#")[0]);
    }
  }
  return targets;
}

/** Resolve a target to a file in the zone, adding ".md" the way notePath does. */
export function resolveLinkTarget(target: string, names: ReadonlySet<string>): string | undefined {
  const clean = target.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (clean === "") return undefined;
  if (names.has(clean)) return clean;
  const withExt = `${clean}.md`;
  return names.has(withExt) ? withExt : undefined;
}

export interface NoteLinks {
  name: string;
  /** zone-relative names this note points at */
  out: string[];
  /** notes pointing at this one */
  back: string[];
  /** this note's targets that resolve to nothing */
  broken: string[];
}

export interface LinkReport {
  dir: string;
  files: number;
  /** resolved link edges across the zone */
  links: number;
  /** zone-wide targets that match no note */
  broken: string[];
  /** notes with no links in or out — empty when the zone has no links at all */
  orphans: string[];
  /** filled only when a note was asked for */
  note?: NoteLinks;
}

export interface LinkOptions {
  /** report one note instead of the whole zone */
  name?: string;
  /** count archive files too (the writing rule; memory hides them) */
  includeArchives?: boolean;
}

/** Build the link graph of a zone, optionally focused on one note. */
export async function linkReport(zoneDir: string, options: LinkOptions = {}): Promise<LinkReport> {
  const notes = (await listNotes(zoneDir)).filter(
    (note) => options.includeArchives || !isArchive(note.name, note.meta),
  );
  const names = new Set(notes.map((note) => note.name));
  const out = new Map<string, string[]>();
  const back = new Map<string, string[]>();
  const brokenBy = new Map<string, string[]>();
  const broken = new Set<string>();

  for (const note of notes) {
    // listNotes skipped anything unreadable, so a failure here is real.
    const body = parseFrontMatter(await fs.readFile(note.path, "utf8")).body;
    const resolved = new Set<string>();
    const missing = new Set<string>();
    for (const target of extractLinks(body)) {
      const hit = resolveLinkTarget(target, names);
      if (hit) resolved.add(hit);
      else {
        missing.add(target);
        broken.add(target);
      }
    }
    const outgoing = [...resolved].sort();
    out.set(note.name, outgoing);
    brokenBy.set(note.name, [...missing].sort());
    for (const target of outgoing) back.set(target, [...(back.get(target) ?? []), note.name]);
  }

  const links = [...out.values()].reduce((sum, list) => sum + list.length, 0);
  const report: LinkReport = {
    dir: zoneDir,
    files: notes.length,
    links,
    broken: [...broken].sort(),
    // Listing every file as an orphan of a bank that simply has no links is
    // noise, not hygiene, so orphans only mean something once links exist.
    orphans:
      links === 0
        ? []
        : notes
            .map((note) => note.name)
            .filter(
              (name) => (out.get(name)?.length ?? 0) === 0 && (back.get(name)?.length ?? 0) === 0,
            ),
  };

  const want = options.name?.trim();
  if (want) {
    const name = resolveLinkTarget(want, names);
    if (!name) throw new Error(`Note not found in this zone: ${want}`);
    report.note = {
      name,
      out: out.get(name) ?? [],
      back: [...(back.get(name) ?? [])].sort(),
      broken: brokenBy.get(name) ?? [],
    };
  }
  return report;
}

/** Render a report the same way for the tool and the CLI. */
export function renderLinkReport(report: LinkReport, label = "zone"): string {
  if (report.note) {
    const { name, out, back, broken } = report.note;
    const lines = [`${name}: ${out.length} out, ${back.length} back`];
    if (out.length > 0) lines.push(`out: ${out.join(", ")}`);
    if (back.length > 0) lines.push(`back: ${back.join(", ")}`);
    if (broken.length > 0) lines.push(`broken: ${broken.join(", ")}`);
    if (out.length === 0 && back.length === 0 && broken.length === 0) {
      lines.push("no links in or out");
    }
    return lines.join("\n");
  }
  if (report.links === 0) {
    const suffix = report.broken.length > 0 ? `, ${report.broken.length} broken` : "";
    return `${label}: ${report.files} file(s), no links between notes${suffix}`;
  }
  const lines = [`${label}: ${report.files} file(s), ${report.links} link(s)`];
  if (report.orphans.length > 0) lines.push(`orphans: ${report.orphans.join(", ")}`);
  if (report.broken.length > 0) lines.push(`broken: ${report.broken.join(", ")}`);
  return lines.join("\n");
}
