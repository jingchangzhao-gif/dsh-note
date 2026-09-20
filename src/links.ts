// Links between notes for dsh-note: what a note points at, what points back at
// it, which targets resolve to nothing, and which notes nothing links to.
//
// Two syntaxes are recognised, both already meaningful in a markdown file:
//   [label](decisions.md)   a normal markdown link
//   [[decisions]]           the note-taking wikilink (optionally [[t|label]])
// Targets are zone-relative names, the same convention every other tool uses.
// A bare name resolves the way the note-taking ecosystem does: exact path, then
// +".md", then a unique basename (shortest path wins), case-insensitively —
// and an ambiguous name stays unresolved rather than guessing.
//
// Not links between notes, so ignored: external URLs, in-page anchors,
// absolute paths, image and media targets, `![alt](…)` embeds of files, links
// inside fenced code blocks, and a note linking to itself (which would only
// hide that nothing else reaches it).

import { promises as fs } from "node:fs";
import { parseFrontMatter, parseTagsList } from "./frontmatter";
import { clampInt } from "./memory";
import { isArchive, listNotes } from "./notes";

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
// `(<target with spaces>)` is the markdown form for targets that contain them.
const MARKDOWN_LINK_RE = /\[[^\]]*\]\((<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\)/g;
// Rewriting needs the pieces separately: target, #anchor, |label, ("title").
const WIKILINK_PARTS_RE = /\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;
const MARKDOWN_PARTS_RE = /(\[[^\]]*\]\()(<[^>]*>|[^)\s]+)(\s+"[^"]*")?(\))/g;
/** Assets, not notes: an image or media link is not an edge in the graph. */
const ASSET_RE = /\.(?:png|jpe?g|gif|svg|webp|avif|bmp|ico|pdf|mp3|mp4|mov|webm|wav|ogg)$/i;

/** Strip the angle brackets a markdown target may be wrapped in. */
function cleanTarget(raw: string): string {
  return raw.replace(/^</, "").replace(/>$/, "").trim();
}

/** True when a cleaned target could name a note rather than a URL or an asset. */
function isNoteTarget(target: string): boolean {
  if (target === "" || target.startsWith("#") || target.startsWith("/")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false; // http:, mailto:, data: …
  return !ASSET_RE.test(target);
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
      const target = cleanTarget(match[1].split("#")[0]);
      if (target && isNoteTarget(target)) targets.push(target);
    }
    for (const match of line.matchAll(MARKDOWN_LINK_RE)) {
      // `![alt](target)` is an image or file embed, not a link between notes.
      if (match.index !== undefined && line[match.index - 1] === "!") continue;
      const target = cleanTarget(match[1].split("#")[0]);
      if (isNoteTarget(target)) targets.push(target);
    }
  }
  return targets;
}

/** Which syntax a rewritten link used: wikilinks omit the extension, markdown keeps it. */
export type LinkForm = "wiki" | "markdown";

export interface RewriteResult {
  body: string;
  /** link occurrences rewritten */
  count: number;
}

/**
 * Rewrite link targets in a body. The callback receives each target (anchor
 * stripped) and its syntax, and returns the replacement target, or undefined to
 * leave that link alone. Anchors, `|labels`, titles, image links and fenced code
 * blocks are preserved as they were.
 */
export function rewriteLinkTargets(
  body: string,
  rewrite: (target: string, form: LinkForm) => string | undefined,
): RewriteResult {
  let count = 0;
  let fenced = false;
  const lines = body.split(/\r?\n/).map((line) => {
    const start = line.trimStart();
    if (start.startsWith("```") || start.startsWith("~~~")) {
      fenced = !fenced;
      return line;
    }
    if (fenced) return line;
    let out = line.replace(
      WIKILINK_PARTS_RE,
      (match: string, target: string, anchor?: string, label?: string) => {
        const next = rewrite(cleanTarget(target), "wiki");
        if (next === undefined) return match;
        count += 1;
        return `[[${next}${anchor ?? ""}${label ?? ""}]]`;
      },
    );
    out = out.replace(
      MARKDOWN_PARTS_RE,
      (
        match: string,
        lead: string,
        rawTarget: string,
        title: string | undefined,
        tail: string,
        offset: number,
        whole: string,
      ) => {
        if (offset > 0 && whole[offset - 1] === "!") return match; // image or file embed
        const bare = cleanTarget(rawTarget);
        const hash = bare.indexOf("#");
        const anchor = hash < 0 ? "" : bare.slice(hash);
        const next = rewrite(hash < 0 ? bare : bare.slice(0, hash), "markdown");
        if (next === undefined) return match;
        count += 1;
        const target = `${next}${anchor}`;
        return `${lead}${/\s/.test(target) ? `<${target}>` : target}${title ?? ""}${tail}`;
      },
    );
    return out;
  });
  return { body: lines.join("\n"), count };
}

/** File name without its directory or note extension. */
function basenameStem(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  return base.replace(/\.(?:md|markdown|txt)$/i, "");
}

/** Aliases that name exactly one file, lower-cased; ambiguous ones are dropped. */
export function uniqueAliases(inputs: readonly LinkInput[]): Map<string, string> {
  const owners = new Map<string, string[]>();
  for (const input of inputs) {
    for (const alias of input.aliases ?? []) {
      const key = alias.trim().toLowerCase();
      if (key === "") continue;
      owners.set(key, [...(owners.get(key) ?? []), input.name]);
    }
  }
  const unique = new Map<string, string>();
  for (const [alias, names] of owners) {
    if (names.length === 1) unique.set(alias, names[0]);
  }
  return unique;
}

/**
 * Resolve a target to a file in the zone. Exact path first, then the bare name
 * against file basenames (case-insensitively, shortest path preferred, the
 * Obsidian/awiki rule), then a front matter alias. Two equally good candidates
 * mean the name is ambiguous, and an ambiguous name resolves to nothing instead
 * of guessing. Aliases cannot shadow a real file name: they are tried last.
 */
export function resolveLinkTarget(
  target: string,
  names: ReadonlySet<string>,
  aliases?: ReadonlyMap<string, string>,
): string | undefined {
  const clean = target.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^<|>$/g, "").trim();
  if (clean === "") return undefined;
  if (names.has(clean)) return clean;
  if (names.has(`${clean}.md`)) return `${clean}.md`;

  const lower = clean.toLowerCase();
  const wanted = new Set([lower, `${lower}.md`]);
  const candidates = [...names].filter(
    (name) => wanted.has(name.toLowerCase()) || basenameStem(name).toLowerCase() === lower,
  );
  if (candidates.length > 0) {
    const shallowest = Math.min(...candidates.map((name) => name.split("/").length));
    const best = candidates.filter((name) => name.split("/").length === shallowest).sort();
    return best.length === 1 ? best[0] : undefined;
  }
  // A path is a path; only a bare name can be an alias.
  if (clean.includes("/")) return undefined;
  const byAlias = aliases?.get(lower);
  return byAlias && names.has(byAlias) ? byAlias : undefined;
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
  /**
   * Linked clusters cut off from the largest one ("islands"), each as its
   * sorted member names, biggest first. Single notes are orphans, not islands.
   */
  islands: string[][];
  /** filled only when a note was asked for */
  note?: NoteLinks;
}

/** One resolved link: the edge a diagram draws. */
export interface LinkEdge {
  from: string;
  to: string;
}

/** A report plus the edges themselves, for callers that draw the graph. */
export interface LinkGraph extends LinkReport {
  edges: LinkEdge[];
}

export interface LinkOptions {
  /** report one note instead of the whole zone */
  name?: string;
  /** count archive files too (the writing rule; memory hides them) */
  includeArchives?: boolean;
}

/** A note that is already read: the pure graph builder needs no filesystem. */
export interface LinkInput {
  name: string;
  /** body text, front matter already stripped */
  body: string;
  /** front matter aliases that may also name this note */
  aliases?: string[];
}

/** Group notes into connected components over the (undirected) link edges. */
function componentsOf(names: readonly string[], edges: readonly LinkEdge[]): string[][] {
  const parent = new Map(names.map((name) => [name, name]));
  const find = (start: string): string => {
    let root = start;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    let walk = start;
    while (parent.get(walk) !== root) {
      const next = parent.get(walk) ?? root;
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };
  for (const edge of edges) {
    if (!parent.has(edge.from) || !parent.has(edge.to)) continue;
    parent.set(find(edge.from), find(edge.to));
  }
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const root = find(name);
    groups.set(root, [...(groups.get(root) ?? []), name]);
  }
  return [...groups.values()].map((group) => group.sort());
}

/**
 * The pure half of the graph: parse and resolve bodies the caller has read.
 * Shared with `zoneMap`, which reads every file anyway and must not read twice.
 */
export function buildLinkGraph(
  dir: string,
  inputs: readonly LinkInput[],
  focus?: string,
): LinkGraph {
  const names = new Set(inputs.map((input) => input.name));
  const aliases = uniqueAliases(inputs);
  const out = new Map<string, string[]>();
  const back = new Map<string, string[]>();
  const brokenBy = new Map<string, string[]>();
  const broken = new Set<string>();
  const edges: LinkEdge[] = [];

  for (const input of inputs) {
    const resolved = new Set<string>();
    const missing = new Set<string>();
    for (const target of extractLinks(input.body)) {
      const hit = resolveLinkTarget(target, names, aliases);
      // A self-link is not connectivity: it must not hide an unreachable note.
      if (hit && hit !== input.name) resolved.add(hit);
      else if (!hit) {
        missing.add(target);
        broken.add(target);
      }
    }
    const outgoing = [...resolved].sort();
    out.set(input.name, outgoing);
    brokenBy.set(input.name, [...missing].sort());
    for (const target of outgoing) {
      back.set(target, [...(back.get(target) ?? []), input.name]);
      edges.push({ from: input.name, to: target });
    }
  }

  const links = [...out.values()].reduce((sum, list) => sum + list.length, 0);
  // Islands only mean something once the zone is linked at all; a cluster is a
  // component of more than one note, so a lone note stays an orphan.
  const components = links === 0 ? [] : componentsOf([...names], edges);
  const clusters = components
    .filter((group) => group.length > 1)
    .sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
  const report: LinkGraph = {
    dir,
    files: inputs.length,
    links,
    broken: [...broken].sort(),
    // Listing every file as an orphan of a bank that simply has no links is
    // noise, not hygiene, so orphans only mean something once links exist.
    orphans:
      links === 0
        ? []
        : inputs
            .map((input) => input.name)
            .filter(
              (name) => (out.get(name)?.length ?? 0) === 0 && (back.get(name)?.length ?? 0) === 0,
            ),
    islands: clusters.slice(1),
    edges,
  };

  const want = focus?.trim();
  if (want) {
    const name = resolveLinkTarget(want, names, aliases);
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

/** Build the link graph of a zone, optionally focused on one note. */
export async function linkReport(zoneDir: string, options: LinkOptions = {}): Promise<LinkGraph> {
  const notes = (await listNotes(zoneDir)).filter(
    (note) => options.includeArchives || !isArchive(note.name, note.meta),
  );
  const inputs: LinkInput[] = [];
  for (const note of notes) {
    // listNotes skipped anything unreadable, so a failure here is real.
    const fm = parseFrontMatter(await fs.readFile(note.path, "utf8"));
    inputs.push({
      name: note.name,
      body: fm.body,
      aliases: parseTagsList(fm.meta.aliases ?? fm.meta.alias),
    });
  }
  return buildLinkGraph(zoneDir, inputs, options.name);
}

/** Island clusters a rendered report lists before it starts counting. */
const ISLAND_CLUSTERS_SHOWN = 3;

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
  if (report.islands.length > 0) {
    const shown = report.islands
      .slice(0, ISLAND_CLUSTERS_SHOWN)
      .map((group) => group.join("+"))
      .join(" | ");
    const rest = report.islands.length - ISLAND_CLUSTERS_SHOWN;
    lines.push(`islands: ${rest > 0 ? `${shown} (+${rest})` : shown}`);
  }
  if (report.broken.length > 0) lines.push(`broken: ${report.broken.join(", ")}`);
  return lines.join("\n");
}

/** Nodes a rendered link graph draws before it starts counting. */
const GRAPH_NODES_MAX = 40;
/** Hard ceiling for a requested node count, so one flag cannot draw 10k boxes. */
const GRAPH_NODES_LIMIT = 500;
/** Longest node label a rendered graph keeps. */
const GRAPH_LABEL_CHARS = 40;

/** A diagram label lives inside ["…"]: one line, no quotes, kept short. */
function graphText(text: string): string {
  const flat = text.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return flat.length > GRAPH_LABEL_CHARS ? `${flat.slice(0, GRAPH_LABEL_CHARS)}…` : flat;
}

export interface GraphOptions {
  /** most nodes to draw (default 40, clamped to 1..500) */
  maxNodes?: number;
}

/**
 * The link graph as a Mermaid flowchart, for a human: notes are nodes, links
 * are edges. Hubs are drawn first, and past the node cap only the
 * best-connected survive — a 200-node diagram is a hairball, not a map, and the
 * omitted count is left in a Mermaid comment. Orphans and island members are
 * styled, so the picture shows what the text report says.
 */
export function renderMermaidGraph(
  graph: LinkGraph,
  label = "zone",
  options: GraphOptions = {},
): string {
  const maxNodes = clampInt(options.maxNodes, GRAPH_NODES_MAX, 1, GRAPH_NODES_LIMIT);
  const degrees = new Map<string, number>();
  for (const edge of graph.edges) {
    degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
    degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1);
  }
  for (const orphan of graph.orphans) degrees.set(orphan, degrees.get(orphan) ?? 0);
  const ranked = [...degrees.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  const drawn = ranked.slice(0, maxNodes);
  const ids = new Map(drawn.map((name, index) => [name, `n${index + 1}`]));

  // No root hub: an invented centre would add edges that are not links.
  const lines = ["```mermaid", "flowchart LR", `  %% ${graphText(label)} link graph`];
  for (const name of drawn) lines.push(`  ${ids.get(name)}["${graphText(name)}"]`);
  for (const edge of graph.edges) {
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (from && to) lines.push(`  ${from} --> ${to}`);
  }
  const classIds = (names: readonly string[]): string[] =>
    names.filter((name) => ids.has(name)).map((name) => ids.get(name) ?? "");
  const orphans = classIds(graph.orphans);
  const islanded = classIds(graph.islands.flat());
  if (orphans.length > 0) {
    lines.push("  classDef orphan fill:#f6f6f6,stroke:#9a9a9a,stroke-dasharray:5 5");
    lines.push(`  class ${orphans.join(",")} orphan`);
  }
  if (islanded.length > 0) {
    lines.push("  classDef island fill:#fff4e5,stroke:#d9822b,stroke-width:2px");
    lines.push(`  class ${islanded.join(",")} island`);
  }
  const omitted = ranked.length - drawn.length;
  if (omitted > 0) lines.push(`  %% ${omitted} more note(s) not shown`);
  if (drawn.length === 0) lines.push(`  none["no notes"]`);
  lines.push("```");
  return lines.join("\n");
}
