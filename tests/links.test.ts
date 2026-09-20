import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractLinks,
  linkReport,
  renderLinkReport,
  renderMermaidGraph,
  resolveLinkTarget,
} from "../src/links";
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

  it("ignores images, media and self-links, and takes angle-bracket targets", async () => {
    const body = [
      "An image ![shot](shot.png) and a wiki embed ![[shot.png]].",
      "A real one [doc](<my note.md>) and [[note]].",
    ].join("\n");
    expect(extractLinks(body)).toEqual(["note", "my note.md"]);

    // A note pointing only at itself has no connectivity, so it stays an
    // orphan — otherwise a self-link would hide that nothing reaches it.
    const dir = await makeDir();
    await writeNote(dir, "self.md", "Points at [[self.md]].");
    const report = await linkReport(dir);
    expect(report.links).toBe(0);
    expect(report.orphans).toEqual([]); // quiet while the zone has no links
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("resolves names with and without an extension, and reports misses", () => {
    const names = new Set(["decisions.md", "log/today.md"]);
    expect(resolveLinkTarget("decisions", names)).toBe("decisions.md");
    expect(resolveLinkTarget("decisions.md", names)).toBe("decisions.md");
    expect(resolveLinkTarget("./log/today.md", names)).toBe("log/today.md");
    expect(resolveLinkTarget("missing", names)).toBeUndefined();
    expect(resolveLinkTarget("  ", names)).toBeUndefined();
  });

  it("resolves a bare name by basename, case-insensitively, refusing ambiguity", () => {
    const names = new Set(["log/today.md", "notes/today.md", "Decisions.md", "deep/a/b/x.md"]);
    expect(resolveLinkTarget("deep/a/b/x", names)).toBe("deep/a/b/x.md");
    expect(resolveLinkTarget("decisions", names)).toBe("Decisions.md"); // case-insensitive
    expect(resolveLinkTarget("today", names)).toBeUndefined(); // two candidates: do not guess
    const oneDeep = new Set(["today.md", "log/today.md"]);
    expect(resolveLinkTarget("today", oneDeep)).toBe("today.md"); // shortest path wins
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
    expect(report.edges).toContainEqual({ from: "hub.md", to: "a.md" });
    expect(report.edges).toHaveLength(3);

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

describe("mermaid link graph", () => {
  it("draws hubs first as a flowchart, with no invented centre", async () => {
    const dir = await makeDir();
    await writeNote(dir, "hub.md", "See [a](a.md) and [b](b.md).");
    await writeNote(dir, "a.md", "Back to [[hub]].");
    await writeNote(dir, "b.md", "nothing");
    const mermaid = renderMermaidGraph(await linkReport(dir), "writing");
    expect(mermaid.startsWith("```mermaid\nflowchart LR")).toBe(true);
    expect(mermaid).toContain("%% writing link graph");
    expect(mermaid).toContain('n1["hub.md"]'); // most connected node first
    expect(mermaid).toContain("-->");
    expect(mermaid).not.toContain("root"); // a centre node would add fake edges
    expect(mermaid.endsWith("```")).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("stops at forty nodes and says what it left out", async () => {
    const dir = await makeDir();
    const links = Array.from({ length: 45 }, (_, i) => `[n${i}](n${i}.md)`).join(" ");
    await writeNote(dir, "hub.md", links);
    for (let i = 0; i < 45; i += 1) await writeNote(dir, `n${i}.md`, "leaf");
    const mermaid = renderMermaidGraph(await linkReport(dir), "writing");
    const nodes = mermaid.split("\n").filter((line) => line.includes('["'));
    expect(nodes).toHaveLength(40);
    expect(mermaid).toMatch(/%% 6 more note\(s\) not shown/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("sanitizes labels and handles an empty zone", () => {
    const graph = {
      dir: "/x",
      files: 2,
      links: 1,
      broken: [],
      orphans: [],
      edges: [{ from: 'a "quoted" and very long name past forty characters.md', to: "b.md" }],
    };
    const mermaid = renderMermaidGraph(graph, 'my "zone"');
    expect(mermaid).toContain("%% my 'zone' link graph");
    expect(mermaid).toContain("a 'quoted'"); // quotes tamed
    expect(mermaid).toContain("…"); // and the long name elided
    expect(mermaid).not.toContain("characters.md");
    expect(mermaid).not.toContain('"quoted"');

    const empty = renderMermaidGraph({
      dir: "/x",
      files: 0,
      links: 0,
      broken: [],
      orphans: [],
      edges: [],
    });
    expect(empty).toContain('none["no notes"]');
  });
});
