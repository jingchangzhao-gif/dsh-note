import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContext } from "../src/context";
import { addMemoryEntry } from "../src/memory";
import { writeNote } from "../src/notes";

async function makeRoot(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "dsh-note-ctx-"));
}

describe("context assembly", () => {
  it("includes named note tails, focus search hits and memory", async () => {
    const root = await makeRoot();
    const body = "intro about compilers\n".repeat(20) + "the key paragraph on pnpm tooling";
    await writeNote(join(root, "notes"), "article.md", body, { title: "Article" });
    await addMemoryEntry(join(root, "memory"), "decided to use pnpm for builds", {
      when: new Date("2024-03-01T00:00:00Z").toISOString(),
    });
    const result = await buildContext({ focus: "pnpm", cwd: root });
    expect(result.parts).toBeGreaterThanOrEqual(2); // search hit + memory
    expect(result.context).toContain("key paragraph");
    expect(result.context).toContain("decided to use pnpm");
    expect(result.chars).toBeGreaterThan(0);
    expect(result.chars).toBeLessThanOrEqual(6000);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("note tails come from the recent end when a note is long", async () => {
    const root = await makeRoot();
    const body = "AAA-UNIQUE-HEAD\n" + "padding line\n".repeat(60) + "fresh recent ending";
    await writeNote(join(root, "notes"), "wip.md", body, {});
    const result = await buildContext({ notes: ["wip.md"], tailPerNote: 400, cwd: root });
    expect(result.context).toContain("fresh recent ending");
    expect(result.context).not.toContain("AAA-UNIQUE-HEAD");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("drops older parts first when the budget is tight", async () => {
    const root = await makeRoot();
    const memory = join(root, "memory");
    await addMemoryEntry(memory, "most recent thing " + "x".repeat(300), {
      when: new Date("2024-03-02T00:00:00Z").toISOString(),
    });
    const result = await buildContext({ chars: 500, cwd: root });
    expect(result.chars).toBeLessThanOrEqual(500);
    expect(result.context).toContain("most recent thing");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns an empty context when nothing matches", async () => {
    const root = await makeRoot();
    const result = await buildContext({ focus: "zzz-no-such-topic", cwd: root });
    expect(result.context).toBe("");
    expect(result.parts).toBe(0);
    await fs.rm(root, { recursive: true, force: true });
  });
});
