import { describe, expect, it } from "vitest";
import { notFoundHint, suggestNames } from "../src/suggest";

const NAMES = ["session.md", "log/today.md", "decisions.md", "Design Notes.md", "plan.txt"];

describe("did you mean", () => {
  it("finds a name that differs only in case or extension", () => {
    expect(suggestNames("SESSION", NAMES)).toEqual(["session.md"]);
    expect(suggestNames("plan.md", NAMES)).toEqual(["plan.txt"]);
    expect(suggestNames("today", NAMES)).toEqual(["log/today.md"]); // basename of a nested note
  });

  it("finds near misses by edit distance, closest first, at most three", () => {
    expect(suggestNames("sesion.md", NAMES)).toEqual(["session.md"]);
    expect(suggestNames("decision", NAMES)).toEqual(["decisions.md"]);
    expect(suggestNames("design", NAMES)).toEqual(["Design Notes.md"]); // a prefix of the stem
    const many = ["a1.md", "a2.md", "a3.md", "a4.md"];
    expect(suggestNames("a", many)).toEqual(["a1.md", "a2.md", "a3.md"]);
  });

  it("suggests nothing for an unrelated name", () => {
    expect(suggestNames("zebra", NAMES)).toEqual([]);
    expect(notFoundHint("zebra", NAMES)).toBe("");
  });

  it("phrases the hint for an error message", () => {
    expect(notFoundHint("sesion", NAMES)).toBe(" (did you mean session.md?)");
    expect(notFoundHint("a", ["a1.md", "a2.md"])).toBe(" (did you mean a1.md or a2.md?)");
  });
});
