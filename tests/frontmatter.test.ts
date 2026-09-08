import { describe, expect, it } from "vitest";
import {
  formatTagsList,
  parseFrontMatter,
  parseTagsList,
  withFrontMatter,
} from "../src/frontmatter";

describe("front matter", () => {
  it("reports no meta when the text has no front matter block", () => {
    const parsed = parseFrontMatter("# Just a heading\nbody");
    expect(parsed.hasFrontMatter).toBe(false);
    expect(parsed.meta).toEqual({});
    expect(parsed.body).toContain("# Just a heading");
  });

  it("parses key/value lines and separates the body", () => {
    const text =
      "---\ntitle: Session\ntags: a, b\ntype: memory\ncreated: 2024-01-01T00:00:00.000Z\n---\n\nbody text";
    const parsed = parseFrontMatter(text);
    expect(parsed.hasFrontMatter).toBe(true);
    expect(parsed.meta.title).toBe("Session");
    expect(parsed.meta.tags).toBe("a, b");
    expect(parsed.meta.type).toBe("memory");
    expect(parsed.meta.created).toBe("2024-01-01T00:00:00.000Z");
    expect(parsed.body.trim()).toBe("body text");
  });

  it("treats an opening mark without a closing one as no front matter", () => {
    const parsed = parseFrontMatter("---\ntitle: x\nnever closed");
    expect(parsed.hasFrontMatter).toBe(false);
  });

  it("round-trips meta and body canonically", () => {
    const meta = { title: "T", summary: "compact digest" };
    const body = "line one\nline two";
    const text = withFrontMatter(meta, body);
    const parsed = parseFrontMatter(text);
    expect(parsed.meta).toEqual(meta);
    expect(parsed.body.trim()).toBe(body);
  });

  it("keeps unknown keys on round-trip", () => {
    const meta = { title: "T", weird_key: "v" };
    const text = withFrontMatter(meta, "body");
    const parsed = parseFrontMatter(text);
    expect(parsed.meta).toEqual(meta);
  });

  it("tags helpers split, trim and dedupe", () => {
    expect(parseTagsList(" a , b , a ")).toEqual(["a", "b"]);
    expect(parseTagsList(undefined)).toEqual([]);
    expect(formatTagsList(["x", "x", " y "])).toBe("x, y");
  });
});
