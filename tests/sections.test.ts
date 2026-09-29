import { describe, expect, it } from "vitest";
import { findSection, noteOutline, renderOutline } from "../src/sections";

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
});
