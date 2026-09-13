import { describe, expect, it } from "vitest";
import type { FrontMeta } from "../src/frontmatter";
import type { NoteContent } from "../src/notes";
import {
  clampSearchLimit,
  compactView,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  tailView,
  visibleOnly,
} from "../src/view";

function note(overrides: Partial<NoteContent> = {}): NoteContent {
  return {
    name: "n.md",
    path: "/tmp/n.md",
    meta: {},
    body: "",
    raw: "",
    ...overrides,
  };
}

describe("shared note views", () => {
  it("clamps the requested search limit without letting NaN through", () => {
    expect(clampSearchLimit(undefined)).toBe(SEARCH_LIMIT_DEFAULT);
    expect(clampSearchLimit(Number.NaN)).toBe(SEARCH_LIMIT_DEFAULT);
    expect(clampSearchLimit(0)).toBe(1);
    expect(clampSearchLimit(-5)).toBe(1);
    expect(clampSearchLimit(3.6)).toBe(4);
    expect(clampSearchLimit(1000)).toBe(SEARCH_LIMIT_MAX);
  });

  it("hides archives by default and returns a copy when asked for everything", () => {
    const items: { name: string; meta: FrontMeta }[] = [
      { name: "live.md", meta: {} },
      { name: "old.archive.md", meta: {} },
      { name: "typed.md", meta: { type: "archive" } },
    ];
    expect(visibleOnly(items, false).map((item) => item.name)).toEqual(["live.md"]);
    expect(visibleOnly(items, true)).toHaveLength(3);
  });

  it("prefixes the compact view with the summary and reports truncation", () => {
    const short = note({ body: "just a little", raw: "just a little" });
    expect(compactView(short)).toEqual({ content: "just a little", truncated: false });

    const long = note({ body: "y".repeat(1000), raw: "y".repeat(1000) });
    const view = compactView(long);
    expect(view.truncated).toBe(true);
    expect(view.content).toHaveLength(801); // "…" plus the 800-char budget

    const withSummary = note({
      meta: { summary: "the digest" },
      body: "tail text",
      raw: "tail text",
    });
    expect(compactView(withSummary).content).toBe("summary: the digest\n\ntail text");
  });

  it("tail view counts the raw text and clamps bad input", () => {
    const full = note({ body: "body", raw: "0123456789" });
    expect(tailView(full, 4)).toEqual({ content: "…6789", truncated: true });
    expect(tailView(full, 100)).toEqual({ content: "0123456789", truncated: false });
    expect(tailView(full, 0)).toEqual({ content: "…9", truncated: true }); // clamped to 1
  });
});
