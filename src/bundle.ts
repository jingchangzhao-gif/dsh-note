// Single-file snapshots of a zone: back up a bank, move it between machines or
// hand it to someone else without copying a folder around.
//
// The bundle is plain JSON rather than a concatenated markdown file, because
// note bodies are arbitrary text: any in-band delimiter ("--- FILE: x ---")
// can occur inside a note and would corrupt the round-trip. JSON escaping via
// the standard library removes that class of bug entirely.

import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { nowIso } from "./frontmatter";
import { ensureDir, listNotes, notePath, writeTextFile } from "./notes";

export const BUNDLE_VERSION = 1;

export interface BundleFile {
  /** zone-relative name, "/"-separated */
  name: string;
  /** full file text, front matter included */
  content: string;
}

export interface Bundle {
  version: number;
  /** when the snapshot was taken */
  exported: string;
  /** folder the snapshot came from (informational; import ignores it) */
  zone: string;
  files: BundleFile[];
}

export interface ExportResult {
  file: string;
  files: number;
  bytes: number;
}

export interface ImportResult {
  files: number;
  /** entries left alone because the target already exists */
  skipped: string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/** Snapshot every file of a zone into one JSON bundle. Read-only on the zone. */
export async function exportZone(zoneDir: string, file: string): Promise<ExportResult> {
  const notes = await listNotes(zoneDir);
  const files: BundleFile[] = [];
  for (const note of notes) {
    // listNotes skipped anything unreadable, so a failure here is real.
    files.push({ name: note.name, content: await fs.readFile(note.path, "utf8") });
  }
  const bundle: Bundle = { version: BUNDLE_VERSION, exported: nowIso(), zone: zoneDir, files };
  const text = `${JSON.stringify(bundle, null, 2)}\n`;
  await ensureDir(dirname(file));
  await writeTextFile(file, text);
  return { file, files: files.length, bytes: Buffer.byteLength(text, "utf8") };
}

/**
 * Write a bundle back into a zone. Existing files are left alone unless
 * `overwrite` is set — restoring must never silently destroy newer notes.
 */
export async function importZone(
  zoneDir: string,
  file: string,
  options: { overwrite?: boolean } = {},
): Promise<ImportResult> {
  let raw = "";
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    throw new Error(`Bundle not found: ${file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Not a dsh-note bundle (invalid JSON): ${file}`);
  }
  const bundle = parsed as Partial<Bundle>;
  if (bundle.version !== BUNDLE_VERSION || !Array.isArray(bundle.files)) {
    throw new Error(`Unsupported bundle format (expected version ${BUNDLE_VERSION}): ${file}`);
  }
  let files = 0;
  const skipped: string[] = [];
  for (const entry of bundle.files) {
    if (typeof entry?.name !== "string" || typeof entry.content !== "string") {
      throw new Error("Bundle entries need a string name and content.");
    }
    const path = notePath(zoneDir, entry.name); // refuses names that escape the zone
    if (!options.overwrite && (await exists(path))) {
      skipped.push(entry.name);
      continue;
    }
    await ensureDir(dirname(path));
    await writeTextFile(path, entry.content);
    files += 1;
  }
  return { files, skipped };
}
