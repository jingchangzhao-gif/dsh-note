import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractLinks, linkReport, renderLinkReport, resolveLinkTarget } from "../src/links";
import { appendNote, writeNote } from "../src/notes";

async function makeDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "dsh-note-links-"));
}

describe("link extraction", () => {
  it("reads markdown links and wikilinks, ignoring URLs, anchors and code", () => {
    const body = [
      "See [decisions](decisions.md) and [[prefs]] plus [[log/today|today]].",
      "External [site](https://example.com) and [mail](mailto:a@b.c) are not notes.",
      "An [anchor](#section), an [absolute](/etc/passwd), and [none]().",
      "```",
      "[fenced](decisions.md) and [[also-fenced]]",
      "```",
      "Back to [decisions#top](decisions.md#top).",
    ].join("\n");
    expect(extractLinks(body)).toEqual(["prefs", "log/today", "decisions.md", "decisions.md"]);
  });

  it("resolves names with and without an extension, and reports misses", () => {
    const names = new Set(["decisions.md", "log/today.md"]);
    expect(resolveLinkTarget("decisions", names)).toBe("decisions.md");
    expect(resolveLinkTarget("decisions.md", names)).toBe("decisions.md");
    expect(resolveLinkTarget("./log/today.md", names)).toBe("log/today.md");
    expect(resolveLinkTarget("missing", names)).toBeUndefined();
    expect(resolveLinkTarget("  ", names)).toBeUndefined();
  });
});

describe("link graph", () => {
  it("reports outgoing, backlinks, broken targets and orphans", async () => {
    const dir = await makeDir();
    await writeNote(dir, "hub.md", "See [a](a.md) and [[b]].");
    await writeNote(dir, "a.md", "Points back at [[hub]].");
    await writeNote(dir, "b.md", "Links to [nowhere](ghost.md).");
    await writeNote(dir, "lonely.md", "no links here");

    const report = await linkReport(dir);
    expect(report.files).toBe(4);
    expect(report.links).toBe(3); // hub->a, hub->b, a->hub
    expect(report.broken).toEqual(["ghost.md"]);
    expect(report.orphans).toEqual(["lonely.md"]);

    const hub = await linkReport(dir, { name: "hub" }); // extension optional
    expect(hub.note).toEqual({
      name: "hub.md",
      out: ["a.md", "b.md"],
      back: ["a.md"],
      broken: [],
    });
    const b = await linkReport(dir, { name: "b.md" });
    expect(b.note?.out).toEqual([]);
    expect(b.note?.broken).toEqual(["ghost.md"]);
    expect(renderLinkReport(b)).toContain("broken: ghost.md");
    expect(renderLinkReport(await linkReport(dir, { name: "lonely.md" }))).toContain(
      "no links in or out",
    );
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("stays quiet about orphans when a zone simply has no links", async () => {
    const dir = await makeDir();
    await appendNote(dir, "one.md", "no links");
    await appendNote(dir, "two.md", "no links either");
    const report = await linkReport(dir);
    expect(report).toMatchObject({ files: 2, links: 0, orphans: [] });
    expect(renderLinkReport(report, "writing")).toBe("writing: 2 file(s), no links between notes");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("hides archives, and refuses a note the zone does not hold", async () => {
    const dir = await makeDir();
    await writeNote(dir, "live.md", "links to [[old.archive]]");
    await writeNote(dir, "old.archive.md", "archived");
    const hidden = await linkReport(dir);
    expect(hidden.files).toBe(1);
    expect(hidden.broken).toEqual(["old.archive"]); // the archive is not a link target
    const shown = await linkReport(dir, { includeArchives: true });
    expect(shown.files).toBe(2);
    expect(shown.broken).toEqual([]);
    expect(shown.note).toBeUndefined();
    await expect(linkReport(dir, { name: "nope.md" })).rejects.toThrow(/Note not found/);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
