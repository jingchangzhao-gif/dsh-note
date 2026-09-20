// Renaming a note without breaking the links that point at it.
//
// The link graph knows which targets resolve to which file, so a rename can be
// planned before anything moves: every note whose links resolved to the old
// name is rewritten. Wikilinks lose the extension the way they were written,
// markdown links keep it, and anchors, `|labels` and titles survive untouched.
// A dry run reports the plan and writes nothing; an existing target name is
// refused rather than overwritten.

import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { parseFrontMatter, parseTagsList, withFrontMatter } from "./frontmatter";
import { resolveLinkTarget, rewriteLinkTargets, uniqueAliases } from "./links";
import type { LinkInput } from "./links";
import {
  ensureDir,
  isArchive,
  listNotes,
  notePath,
  writeTextFile,
  zoneRelativeName,
} from "./notes";

export interface RenameOptions {
  /** report the plan without touching any file */
  dryRun?: boolean;
  /** consider archive files too (the writing rule; memory hides them) */
  includeArchives?: boolean;
}

export interface RenameResult {
  /** the note's name before, resolved from whatever the caller passed */
  from: string;
  /** the note's name after */
  to: string;
  /** absolute path of the renamed file */
  path: string;
  /** false for a dry run, or when the name did not actually change */
  moved: boolean;
  dryRun: boolean;
  /** notes whose links were (or would be) rewritten */
  rewritten: string[];
  /** link occurrences rewritten across those notes */
  links: number;
}

/** Strip a note extension, for wikilink targets that omit it. */
function withoutExt(name: string): string {
  return name.replace(/\.(?:md|markdown|txt)$/i, "");
}

/** Plan and apply a rename inside one zone, rewriting the links that follow it. */
export async function renameNote(
  zoneDir: string,
  from: string,
  to: string,
  options: RenameOptions = {},
): Promise<RenameResult> {
  const notes = (await listNotes(zoneDir)).filter(
    (note) => options.includeArchives || !isArchive(note.name, note.meta),
  );
  const raws = new Map<string, string>();
  const inputs: LinkInput[] = [];
  for (const note of notes) {
    // listNotes skipped anything unreadable, so a failure here is real.
    const raw = await fs.readFile(note.path, "utf8");
    raws.set(note.name, raw);
    const fm = parseFrontMatter(raw);
    inputs.push({
      name: note.name,
      body: fm.body,
      aliases: parseTagsList(fm.meta.aliases ?? fm.meta.alias),
    });
  }
  const names = new Set(notes.map((note) => note.name));
  const aliases = uniqueAliases(inputs);
  const oldName = resolveLinkTarget(from, names, aliases);
  if (!oldName) throw new Error(`Note not found in this zone: ${from}`);

  const newPath = notePath(zoneDir, to); // validates the name and blocks escapes
  const newName = zoneRelativeName(zoneDir, newPath);
  // Same name: nothing to move, nothing to rewrite — not an error.
  if (newName === oldName) {
    return {
      from: oldName,
      to: newName,
      path: newPath,
      moved: false,
      dryRun: Boolean(options.dryRun),
      rewritten: [],
      links: 0,
    };
  }
  if (names.has(newName)) throw new Error(`A note already exists: ${newName}`);

  const plans: { name: string; path: string; text: string; count: number }[] = [];
  {
    for (const note of notes) {
      const raw = raws.get(note.name) ?? "";
      const fm = parseFrontMatter(raw);
      const { body, count } = rewriteLinkTargets(fm.body, (target, form) => {
        if (resolveLinkTarget(target, names, aliases) !== oldName) return undefined;
        return form === "wiki" ? withoutExt(newName) : newName;
      });
      if (count === 0) continue;
      plans.push({
        name: note.name,
        path: note.path,
        text: fm.hasFrontMatter ? withFrontMatter(fm.meta, body) : `${body.trimEnd()}\n`,
        count,
      });
    }
  }
  const rewritten = plans.map((plan) => plan.name);
  const links = plans.reduce((sum, plan) => sum + plan.count, 0);

  if (options.dryRun) {
    return {
      from: oldName,
      to: newName,
      path: newPath,
      moved: false,
      dryRun: true,
      rewritten,
      links,
    };
  }

  // Move first, then rewrite: the renamed file's own content is written to its
  // new path, and every other file keeps its path.
  await ensureDir(dirname(newPath));
  await fs.rename(notePath(zoneDir, oldName), newPath);
  for (const plan of plans) {
    await writeTextFile(plan.name === oldName ? newPath : plan.path, plan.text);
  }
  return {
    from: oldName,
    to: newName,
    path: newPath,
    moved: true,
    dryRun: false,
    rewritten,
    links,
  };
}
