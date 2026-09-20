// Zone overviews for dsh-note: how big is a notes/memory folder right now, and
// what shape does it have? Pure read-only file work, so an agent can decide
// what to recall (and whether to compact) before spending a token on content:
// `zoneStats` gives the totals, `zoneMap` the outline.

import { promises as fs } from "node:fs";
import { parseFrontMatter } from "./frontmatter";
import { buildLinkGraph } from "./links";
import { clampInt, parseMemory } from "./memory";
import type { MemoryEntry } from "./memory";
import { isArchive, listNotes } from "./notes";
import type { NoteFile } from "./notes";

export interface ZoneStats {
  /** resolved folder the numbers describe */
  dir: string;
  /** live note files (archives excluded) */
  files: number;
  /** archive files (memory_compact output) */
  archives: number;
  /** timestamped memory entries across the live files */
  entries: number;
  /** total UTF-8 bytes on disk in the zone */
  bytes: number;
  /** biggest file in the zone, or null when it is empty */
  largest: { name: string; bytes: number } | null;
}

/** Count files, memory entries and bytes in one zone. Never calls a model. */
export async function zoneStats(zoneDir: string): Promise<ZoneStats> {
  const notes = await listNotes(zoneDir);
  let files = 0;
  let archives = 0;
  let entries = 0;
  let bytes = 0;
  let largest: { name: string; bytes: number } | null = null;
  for (const note of notes) {
    // listNotes already skipped anything it could not read, so this read either
    // succeeds or the file vanished mid-scan — which should be loud, not silent.
    const raw = await fs.readFile(note.path, "utf8");
    const size = Buffer.byteLength(raw, "utf8");
    bytes += size;
    if (isArchive(note.name, note.meta)) {
      archives += 1;
    } else {
      files += 1;
      entries += parseMemory(parseFrontMatter(raw).body).entries.length;
    }
    if (!largest || size > largest.bytes) largest = { name: note.name, bytes: size };
  }
  return { dir: zoneDir, files, archives, entries, bytes, largest };
}

/** Newest entry headings shown per file, so one huge bank file cannot eat the map. */
const MAP_HEADINGS_PER_FILE = 5;
/** Longest heading a map keeps before eliding the tail. */
const MAP_HEADING_CHARS = 100;

export interface MapFile {
  name: string;
  title?: string;
  /** timestamped entries in the file */
  entries: number;
  bytes: number;
  /** newest entry headings, newest first (memory files only) */
  headings: string[];
}

export interface ZoneMap {
  dir: string;
  /** files actually listed, in name order */
  files: MapFile[];
  /** files in the zone before the char budget cut anything */
  total: number;
  /** files the budget left out */
  omitted: number;
  /** true when headings or whole files were dropped to fit */
  truncated: boolean;
  /** resolved link edges between the zone's notes */
  links: number;
  /** link targets matching no note */
  broken: string[];
  /** notes with no links in or out (empty when the zone has none at all) */
  orphans: string[];
}

export interface MapOptions {
  /** character budget for the rendered outline (default 1200) */
  chars?: number;
  /** count archive files too (the writing rule; memory hides them) */
  includeArchives?: boolean;
}

/** One file's line in a map; shared so budgeting and rendering cannot drift. */
function mapFileLine(file: MapFile): string {
  const title = file.title ? ` — ${file.title}` : "";
  const count =
    file.entries > 0 ? `${file.entries} ${file.entries === 1 ? "entry" : "entries"}, ` : "";
  return `- ${file.name}${title} (${count}${file.bytes} bytes)`;
}

/** Entry heading for a map: no "## ", date only, elided when very long. */
function mapHeading(entry: MemoryEntry): string {
  const newline = entry.text.indexOf("\n");
  const line = (newline < 0 ? entry.text : entry.text.slice(0, newline))
    .replace(/^##[ \t]+/, "")
    .trim();
  // The exact time rarely matters for an outline; recalling shows it in full.
  const short = entry.when ? line.replace(entry.when, entry.when.slice(0, 10)) : line;
  return short.length > MAP_HEADING_CHARS ? `${short.slice(0, MAP_HEADING_CHARS)}…` : short;
}

/**
 * Outline a zone: one line per file plus the newest entry headings of each,
 * bounded by a character budget. Deliberately cheaper than recalling bodies —
 * headings usually carry the gist, and a map is enough to pick what to recall.
 */
export async function zoneMap(zoneDir: string, options: MapOptions = {}): Promise<ZoneMap> {
  const budget = clampInt(options.chars, 1200, 200, 20_000);
  const notes = (await listNotes(zoneDir)).filter(
    (note) => options.includeArchives || !isArchive(note.name, note.meta),
  );
  // Read each file once and read all of them: the link graph needs every body,
  // so an early exit on the budget would silently under-count relationships.
  const prepared: { note: NoteFile; body: string; bytes: number }[] = [];
  for (const note of notes) {
    // listNotes already skipped anything unreadable; a vanished file should be
    // loud here rather than silently shrinking the map.
    const raw = await fs.readFile(note.path, "utf8");
    prepared.push({
      note,
      body: parseFrontMatter(raw).body,
      bytes: Buffer.byteLength(raw, "utf8"),
    });
  }
  const graph = buildLinkGraph(
    zoneDir,
    prepared.map(({ note, body }) => ({ name: note.name, body })),
  );

  const files: MapFile[] = [];
  let used = 0;
  let omitted = 0;
  let truncated = false;
  for (let index = 0; index < prepared.length; index += 1) {
    const { note, body, bytes } = prepared[index];
    const { entries } = parseMemory(body);
    const file: MapFile = {
      name: note.name,
      title: note.title,
      entries: entries.length,
      bytes,
      headings: [],
    };
    const line = mapFileLine(file);
    if (used + line.length + 1 > budget) {
      omitted = prepared.length - index;
      truncated = true;
      break;
    }
    used += line.length + 1;
    for (const heading of entries.slice(-MAP_HEADINGS_PER_FILE).reverse().map(mapHeading)) {
      const cost = heading.length + 3; // "  " + "\n"
      if (used + cost > budget) {
        truncated = true;
        break;
      }
      used += cost;
      file.headings.push(heading);
    }
    files.push(file);
  }
  return {
    dir: zoneDir,
    files,
    total: notes.length,
    omitted,
    truncated,
    links: graph.links,
    broken: graph.broken,
    orphans: graph.orphans,
  };
}

/** Orphan names a rendered map lists before it starts counting. */
const ORPHAN_NAMES_SHOWN = 5;

/** Render a map the same way for the tool and the CLI. */
export function renderZoneMap(map: ZoneMap, label = "zone"): string {
  const lines = [`${label} map: ${map.total} file(s)`];
  for (const file of map.files) {
    lines.push(mapFileLine(file));
    for (const heading of file.headings) lines.push(`  ${heading}`);
  }
  if (map.omitted > 0) lines.push(`… ${map.omitted} more file(s) not shown`);
  // Relationships ride along so one cheap call gives shape *and* structure;
  // a zone with no links says nothing, the way note_links stays quiet.
  if (map.links > 0) {
    const broken = map.broken.length > 0 ? ` (${map.broken.length} broken)` : "";
    lines.push(`links: ${map.links}${broken}`);
    if (map.orphans.length > 0) {
      const shown = map.orphans.slice(0, ORPHAN_NAMES_SHOWN).join(", ");
      const rest = map.orphans.length - ORPHAN_NAMES_SHOWN;
      lines.push(`orphans: ${rest > 0 ? `${shown} (+${rest})` : shown}`);
    }
  }
  return lines.join("\n");
}

/** Longest label a rendered mind map keeps. */
const MERMAID_LABEL_CHARS = 60;

/** A mind-map label lives inside ["…"]: one line, no quotes, kept short. */
function mermaidText(text: string): string {
  const flat = text.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return flat.length > MERMAID_LABEL_CHARS ? `${flat.slice(0, MERMAID_LABEL_CHARS)}…` : flat;
}

/**
 * The same outline as a Mermaid mind map, for a human: paste the block into any
 * markdown viewer (GitHub, Obsidian, VS Code, the dsh GUI) and it renders.
 * Labels are quoted and sanitized so a note title cannot break the diagram.
 */
export function renderMermaidMap(map: ZoneMap, label = "zone"): string {
  const lines = ["```mermaid", "mindmap", `  root["${mermaidText(label)}"]`];
  let nodes = 0;
  for (const file of map.files) {
    nodes += 1;
    lines.push(`    n${nodes}["${mermaidText(mapFileLine(file).replace(/^- /, ""))}"]`);
    for (const heading of file.headings) {
      nodes += 1;
      lines.push(`      n${nodes}["${mermaidText(heading)}"]`);
    }
  }
  if (map.omitted > 0) lines.push(`    more["… ${map.omitted} more file(s) not shown"]`);
  lines.push("```");
  return lines.join("\n");
}
