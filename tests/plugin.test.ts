// The plugin entry is wiring, so it was excluded from coverage and exercised
// nowhere: a forgotten `ctx.tools.register(...)` would only show up inside a
// running dsh. This loads the real entry with a stub context and checks what it
// actually registers — the tool surface itself is tested in tools.test.ts.

import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { apply, inject, name } from "../src/index";

interface RegisteredTool {
  name: string;
  description: string;
  output: { schema: unknown };
}

const EXPECTED_TOOLS = [
  "memory_add",
  "memory_compact",
  "memory_recall",
  "memory_remove",
  "memory_update",
  "note_context",
  "note_edit",
  "note_forget",
  "note_links",
  "note_list",
  "note_map",
  "note_recall",
  "note_remember",
  "note_rename",
  "note_search",
  "note_stats",
  "note_write",
];

/** Run the plugin's apply() against a stub registry and collect the tools. */
function registeredTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  const ctx = { tools: { register: (tool: RegisteredTool) => tools.push(tool) } };
  apply(ctx as unknown as Context);
  return tools;
}

describe("plugin registration", () => {
  it("declares the plugin and registers every tool exactly once", () => {
    expect(name).toBe("note");
    expect(inject).toEqual(["tools"]);

    const tools = registeredTools();
    const names = tools.map((tool) => tool.name);
    expect([...names].sort()).toEqual(EXPECTED_TOOLS);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.output.schema).toBeTruthy();
    }
  });

  it("documents every registered tool in the README", async () => {
    const readme = await fs.readFile(
      fileURLToPath(new URL("../README.md", import.meta.url)),
      "utf8",
    );
    for (const tool of registeredTools()) {
      expect(readme).toContain(`\`${tool.name}\``);
    }
  });

  it("documents every CLI command in the README and in its own help", async () => {
    const cli = await fs.readFile(fileURLToPath(new URL("../cli.mjs", import.meta.url)), "utf8");
    const readme = await fs.readFile(
      fileURLToPath(new URL("../README.md", import.meta.url)),
      "utf8",
    );
    const block = /const COMMANDS = new Set\(\[([\s\S]*?)\]\)/.exec(cli)?.[1] ?? "";
    const commands = [...block.matchAll(/"([^"]+)"/g)]
      .map((match) => match[1])
      .filter((command) => command !== "help");
    expect(commands.length).toBeGreaterThan(15);
    for (const command of commands) {
      expect(readme).toContain(`\`${command}`);
      expect(cli).toMatch(new RegExp(`^  ${command}[ <\\[]`, "m")); // a help line
    }
  });
});
