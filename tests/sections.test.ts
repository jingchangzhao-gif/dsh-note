import { describe, expect, it } from "vitest";
import { findSection, noteOutline, patchSection, renderOutline } from "../src/sections";

const BODY = [
  "intro line",
  "",
  "# Plan",
  "",
  "the plan",
  "",
  "## Setup",
  "",
  "install pnpm",
  "",
  "```sh",
  "# not a heading, a shell comment",
  "```",
  "",
  "### Details ###",
  "",
  "fine print",
  "",
  "## Rollout",
  "",
  "ship it",
].join("\n");

describe("note sections", () => {
  it("outlines ATX headings with their section sizes, skipping code fences", () => {
    const outline = noteOutline(BODY);
    expect(outline.map((h) => [h.level, h.text])).toEqual([
      [1, "Plan"],
      [2, "Setup"],
      [3, "Details"],
      [2, "Rollout"],
    ]);
    // A section runs to the next heading of the same or a higher level.
    const setup = outline[1];
    expect(setup.chars).toBe(findSection(BODY, "Setup").text.length);
    expect(outline[0].chars).toBeGreaterThan(setup.chars); // Plan contains Setup
  });

  it("renders the outline indented by level", () => {
    expect(renderOutline(noteOutline(BODY))).toBe(
      [
        `# Plan (${noteOutline(BODY)[0].chars} chars)`,
        `  ## Setup (${noteOutline(BODY)[1].chars} chars)`,
        `    ### Details (${noteOutline(BODY)[2].chars} chars)`,
        `  ## Rollout (${noteOutline(BODY)[3].chars} chars)`,
      ].join("\n"),
    );
    expect(renderOutline([])).toBe("(no headings)");
  });

  it("returns one section with its subsections, matching the heading loosely", () => {
    const setup = findSection(BODY, "  setup ");
    expect(setup.text.startsWith("## Setup")).toBe(true);
    expect(setup.text).toContain("install pnpm");
    expect(setup.text).toContain("fine print"); // ### Details belongs to Setup
    expect(setup.text).not.toContain("ship it");
    expect(findSection(BODY, "## Rollout").text).toBe("## Rollout\n\nship it");
  });

  it("names the headings that exist when the one asked for does not", () => {
    expect(() => findSection(BODY, "Deploy")).toThrow(
      /^Section not found: Deploy \(headings: Plan, Setup, Details, Rollout\)$/,
    );
    expect(() => findSection("no headings here", "x")).toThrow(/\(this note has no headings\)/);
  });

  it("refuses an ambiguous heading instead of guessing", () => {
    const body = "## Notes\n\none\n\n## Notes\n\ntwo";
    expect(() => findSection(body, "notes")).toThrow(
      /^Section is ambiguous: "notes" matches 2 headings \(lines 1, 5\)$/,
    );
  });

  it("replaces a section's content, subsections included, and keeps its heading", () => {
    const out = patchSection(BODY, "setup", "use pnpm 10", "replace");
    expect(findSection(out, "Setup").text).toBe("## Setup\n\nuse pnpm 10");
    expect(out).not.toContain("fine print"); // ### Details was part of Setup
    expect(out.startsWith("intro line\n\n# Plan\n\nthe plan\n\n## Setup")).toBe(true);
    expect(out.endsWith("## Rollout\n\nship it")).toBe(true);
  });

  it("appends at the end of a section and prepends under its heading", () => {
    const appended = patchSection(BODY, "Setup", "then run tests", "append");
    expect(findSection(appended, "Setup").text.endsWith("fine print\n\nthen run tests")).toBe(true);
    expect(findSection(appended, "Rollout").text).toBe("## Rollout\n\nship it");
    const prepended = patchSection(BODY, "Rollout", "after QA:", "prepend");
    expect(findSection(prepended, "Rollout").text).toBe("## Rollout\n\nafter QA:\n\nship it");
    // The last section, and a heading with nothing under it yet.
    expect(patchSection("## Empty", "empty", "now filled", "prepend")).toBe(
      "## Empty\n\nnow filled",
    );
  });

  it("refuses a section edit it cannot place exactly", () => {
    expect(() => patchSection(BODY, "Deploy", "x", "append")).toThrow(/Section not found: Deploy/);
    expect(() => patchSection("## A\n\n## A", "a", "x", "replace")).toThrow(/ambiguous/);
    expect(() => patchSection(BODY, "Setup", "  ", "append")).toThrow(/Text to append is required/);
  });
});
