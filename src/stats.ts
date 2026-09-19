// Zone inventory for dsh-note: how big is a notes/memory folder right now?
// Pure read-only file work, so an agent can decide how much to recall (and
// whether to compact) before spending a single token on the content itself.

import { promises as fs } from "node:fs";
import { parseFrontMatter } from "./frontmatter";
import { parseMemory } from "./memory";
import { isArchive, listNotes } from "./notes";

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
