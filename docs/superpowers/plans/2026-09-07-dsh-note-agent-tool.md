# dsh-note — Simple Agent Notes Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four markdown-note tools (`note_read`, `note_list`, `note_append`, `note_search`) to `dsh-note`, a dependency-free DeepSeek Harness plugin, so the agent can maintain lightweight text notes in its workspace.

**Architecture:** A `src/notes.ts` module owns all filesystem operations against a notes directory (default `./notes` under the session workspace, overridable via `dir`). Four `defineTool` wrappers in `src/note-tools.ts` expose read/list/append/search. Entry `src/index.ts` registers them. No network, no LLM calls, no third-party deps — only `node:fs`, `node:path`.

**Tech Stack:** TypeScript, `@deepseek-ai/dsh-tools` `defineTool` API, pnpm, vitest, oxlint, tsdown. Node 18+.

---

## File Structure

- `src/notes.ts` — **new.** `resolveNotesDir(exec, dir?)`, `listNotes`, `readNote`, `appendNote`, `searchNotes`. All sync `node:fs`, validated, throwing readable errors.
- `src/note-tools.ts` — **new.** Four `defineTool`s wiring the above.
- `src/index.ts` — **new.** Entry registering the four tools (`name = "note"`, `inject = ["tools"]`).
- `tests/notes.test.ts` — **new.** FS-level tests using a temp dir (written by the pairing partner).
- `tests/note-tools.test.ts` — **new.** Tool-execute tests (written by the pairing partner).
- `package.json`, `tsconfig.json`, `tsdown.config.ts`, `.gitignore`, `.prettierrc.json`, `.oxlintrc.json`, `cordis.patch.yml`, `SECURITY.md`, `LICENSE`, `.github/workflows/ci.yml` — **copy** from `dsh-git-tools` (adjust name/entry).

> **Pairing split (co-author note):** Tasks 1–3 (implementation, author: whoever commits) add the repo owner as co-author. Task 4 (tests) is authored by the pairing partner. Merge with a **non-squash merge** so co-author trailers survive.

---

### Task 0: Scaffold config from the reference plugin

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsdown.config.ts`, `.gitignore`, `.prettierrc.json`, `.oxlintrc.json`, `cordis.patch.yml`, `SECURITY.md`, `LICENSE`, `.github/workflows/ci.yml`

- [ ] **Step 1: Copy config files from `dsh-git-tools`**

Reference repo: `/Users/brocode/uni/github/dsh-git-tools` (or the merged `dsh-web-search`). Copy these files, renaming references to `dsh-git-tools`/`dsh-web-search` → `dsh-note`:

`tsconfig.json`, `tsdown.config.ts` (set `name: "dsh-note"`, `entry: ["src/index.ts"]`), `.prettierrc.json`, `.oxlintrc.json`, `.gitignore`, `cordis.patch.yml`, `SECURITY.md`.

`package.json` (pin `@deepseek-ai/dsh-tools` to `=0.1.0-rc.8` in peerDependencies; keep the same devDeps & scripts):
```json
{
  "name": "dsh-note",
  "version": "0.1.0",
  "description": "Markdown note tools for DeepSeek Harness (dsh): read, list, append, search.",
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./package.json": "./package.json" },
  "files": ["lib", "cordis.patch.yml", "SECURITY.md"],
  "scripts": {
    "build": "tsdown",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "oxlint",
    "prepublishOnly": "pnpm run build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "=0.1.0-rc.8"
  },
  "devDependencies": {
    "@types/node": "^22.20.0",
    "oxlint": "^1.80.0",
    "prettier": "^3.9.6",
    "tsdown": "0.22.2",
    "typescript": "~5.7.2",
    "vitest": "^2.1.9"
  },
  "engines": { "node": ">=18" },
  "license": "MIT"
}
```

- [ ] **Step 2: Add `LICENSE` and `.github/workflows/ci.yml`**

CI workflow (same as reference):
```yaml
name: CI
on:
  push: { branches: ["main"] }
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm lint
      - run: pnpm build
```

- [ ] **Step 3: Install, verify baseline**

Run: `pnpm install`, `pnpm typecheck`, `pnpm lint`
Expected: install succeeds (deps resolvable with the pinned dsh-tools), typecheck + lint pass (nothing to check yet is fine).

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "chore: scaffold dsh-note plugin" --trailer "Co-authored-by: jingchangzhao-gif <252637410+jingchangzhao-gif@users.noreply.github.com>"
```

---

### Task 1: notes.ts — filesystem operations

**Files:**
- Create: `src/notes.ts`

- [ ] **Step 1: Write `src/notes.ts`**

```ts
// Markdown note filesystem operations for the dsh agent.
// Pure node:fs; no network, no third-party deps.

import { promises as fs } from "node:fs";
import { join, dirname, basename, extname, resolve, isAbsolute } from "node:path";

export interface NoteFile {
  name: string; // basename including extension
  path: string;
  title?: string; // first "# " heading, if present
}

export const NOTES_EXTENSIONS = [".md", ".markdown", ".txt"] as const;

export interface ExecLike {
  cwd?: string;
  dir?: string; // optional notes-dir override the host provides
  signal?: AbortSignal;
}

export function resolveNotesDir(cwd: string | undefined, requestedDir?: string): string {
  // Allow an absolute override; otherwise a subdir of the workspace.
  const base = requestedDir && isAbsolute(requestedDir)
    ? requestedDir
    : join(cwd ?? process.cwd(), requestedDir || "notes");
  return resolve(base);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function listNotes(dir: string): Promise<NoteFile[]> {
  await ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && NOTES_EXTENSIONS.includes(extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort();
  const out: NoteFile[] = [];
  for (const name of files) {
    const path = join(dir, name);
    const text = await fs.readFile(path, "utf8");
    const m = text.match(/^#\s+(.+)$/m);
    out.push({ name, path, title: m?.[1]?.trim() });
  }
  return out;
}

export async function readNote(dir: string, name: string, maxChars?: number): Promise<string> {
  // Guard against path traversal.
  const base = basename(name);
  const path = join(dir, base);
  const text = await fs.readFile(path, "utf8");
  if (maxChars == null) return text;
  const cap = Math.min(Math.max(1, Math.round(maxChars)), 100_000);
  return text.slice(0, cap);
}

export async function appendNote(
  dir: string,
  name: string,
  content: string,
): Promise<{ name: string; path: string }> {
  await ensureDir(dir);
  const path = join(dir, basename(name));
  const sep = "\n\n---\n\n";
  let existing = "";
  try {
    existing = await fs.readFile(path, "utf8");
  } catch {
    /* new note */
  }
  const next = existing ? existing + sep + content.trim() : content.trim();
  await fs.writeFile(path, next + "\n", "utf8");
  return { name: basename(name), path };
}

export interface NoteHit {
  name: string;
  line: number;
  lineText: string;
}

export async function searchNotes(dir: string, term: string): Promise<NoteHit[]> {
  await ensureDir(dir);
  const lower = term.toLowerCase();
  const notes = await listNotes(dir);
  const hits: NoteHit[] = [];
  for (const note of notes) {
    const text = await fs.readFile(note.path, "utf8");
    text.split("\n").forEach((line, index) => {
      if (line.toLowerCase().includes(lower)) {
        hits.push({ name: note.name, line: index + 1, lineText: line.trim().slice(0, 200) });
      }
    });
  }
  return hits;
}
```

> Note: `dirname`, `resolve` are imported for completeness of path helpers used by tests; if lint flags unused imports, remove only the unused ones.

- [ ] **Step 2: Typecheck & lint**

Run: `pnpm typecheck`, `pnpm lint`
Expected: pass (drop unused imports if lint complains).

- [ ] **Step 3: Commit**

```bash
git add src/notes.ts
git commit -m "feat: add note filesystem operations" --trailer "Co-authored-by: jingchangzhao-gif <252637410+jingchangzhao-gif@users.noreply.github.com>"
```

---

### Task 2: note-tools.ts — the four defineTool wrappers

**Files:**
- Create: `src/note-tools.ts`

- [ ] **Step 1: Write `src/note-tools.ts`**

```ts
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  resolveNotesDir,
  listNotes,
  readNote,
  appendNote,
  searchNotes,
} from "./notes";

// Tools assume the host passes `cwd` (session workspace) via exec; dir is an
// optional override. We read cwd off the exec context when present.

type ExecCtx = { cwd?: string; signal?: AbortSignal; [k: string]: unknown };

function baseDir(args: { dir?: string }, exec: ExecCtx): string {
  return resolveNotesDir((exec as { cwd?: string }).cwd, args.dir);
}

export const noteListTool = defineTool({
  name: "note_list",
  description: "List markdown notes in the notes directory (default ./notes).",
  parameters: {
    dir: { type: "string", description: "Optional notes directory override." },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        dir: { type: "string" },
        notes: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, path: { type: "string" }, title: { type: "string" } },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { dir?: string; notes?: { name: string; title?: string }[] };
      const lines = [`Notes in ${v.dir ?? "?"}:`];
      for (const n of v.notes ?? []) lines.push(`- ${n.name}${n.title ? ` — ${n.title}` : ""}`);
      return [{ type: "text", text: lines.join("\n") }];
    },
  },
  async execute(args, exec) {
    const dir = baseDir(args ?? {}, exec as ExecCtx);
    const notes = await listNotes(dir);
    return { dir, notes };
  },
});

export const noteReadTool = defineTool({
  name: "note_read",
  description: "Read a note's full text (optionally capped).",
  parameters: {
    name: { type: "string", description: "Note filename, e.g. todo.md." },
    dir: { type: "string", description: "Optional notes directory override." },
    maxChars: { type: "number", description: "Optional max characters to return." },
  },
  output: {
    schema: {
      type: "object",
      properties: { name: { type: "string" }, content: { type: "string" } },
      additionalProperties: false,
    },
    render: (_args, value) => [{ type: "text", text: (value as { content?: string }).content ?? "" }],
  },
  async execute(args, exec) {
    const { name, maxChars } = args ?? {};
    if (!name) throw new Error("A note name is required.");
    const dir = baseDir(args ?? {}, exec as ExecCtx);
    const content = await readNote(dir, name, maxChars);
    return { name, content };
  },
});

export const noteAppendTool = defineTool({
  name: "note_append",
  description: "Append a block to a note, creating it if missing.",
  parameters: {
    name: { type: "string", description: "Note filename, e.g. todo.md." },
    content: { type: "string", description: "Markdown/text to append." },
    dir: { type: "string", description: "Optional notes directory override." },
  },
  output: {
    schema: {
      type: "object",
      properties: { name: { type: "string" }, path: { type: "string" } },
      additionalProperties: false,
    },
    render: (_args, value) => [{ type: "text", text: `Appended to ${(value as { name?: string }).name ?? ""}` }],
  },
  async execute(args, exec) {
    const { name, content } = args ?? {};
    if (!name) throw new Error("A note name is required.");
    if (!content) throw new Error("Content to append is required.");
    const dir = baseDir(args ?? {}, exec as ExecCtx);
    return appendNote(dir, name, content);
  },
});

export const noteSearchTool = defineTool({
  name: "note_search",
  description: "Search notes for a term, returning file:line matches.",
  parameters: {
    term: { type: "string", description: "Text to search for (case-insensitive)." },
    dir: { type: "string", description: "Optional notes directory override." },
  },
  output: {
    schema: {
      type: "object",
      properties: {
        term: { type: "string" },
        hits: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, line: { type: "number" }, lineText: { type: "string" } },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    render: (_args, value) => {
      const v = value as { term?: string; hits?: { name: string; line: number; lineText: string }[] };
      const lines = [`Matches for "${v.term ?? ""}":`];
      for (const h of v.hits ?? []) lines.push(`${h.name}:${h.line}  ${h.lineText}`);
      return [{ type: "text", text: lines.join("\n") }];
    },
  },
  async execute(args, exec) {
    const { term } = args ?? {};
    if (!term) throw new Error("A search term is required.");
    const dir = baseDir(args ?? {}, exec as ExecCtx);
    const hits = await searchNotes(dir, term);
    return { term, hits };
  },
});
```

- [ ] **Step 2: Typecheck & lint**

Run: `pnpm typecheck`, `pnpm lint`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/note-tools.ts
git commit -m "feat: expose note read/list/append/search tools" --trailer "Co-authored-by: jingchangzhao-gif <252637410+jingchangzhao-gif@users.noreply.github.com>"
```

---

### Task 3: entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write `src/index.ts`**

```ts
import type { Context } from "@deepseek-ai/cordis";
import { noteListTool, noteReadTool, noteAppendTool, noteSearchTool } from "./note-tools";

export const name = "note";
export const inject = ["tools"];

export function apply(ctx: Context) {
  ctx.tools.register(noteListTool);
  ctx.tools.register(noteReadTool);
  ctx.tools.register(noteAppendTool);
  ctx.tools.register(noteSearchTool);
}
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: `lib/index.js` built, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: register dsh-note tools" --trailer "Co-authored-by: jingchangzhao-gif <252637410+jingchangzhao-gif@users.noreply.github.com>"
```

---

### Task 4: Tests (pairing partner)

**Files:**
- Create: `tests/notes.test.ts`, `tests/note-tools.test.ts`

> Authored by the **pairing partner** (jingchangzhao-gif), with `Co-authored-by: Shyboy0499`. Use a temp dir via `fs.mkdtemp(os.tmpdir()...)` for FS tests.

- [ ] **Step 1: Create `tests/notes.test.ts`** covering listNotes (filters extensions, sorts), readNote (capped), appendNote (creates + appends), searchNotes (case-insensitive hit + line numbers), path-traversal guard (`basename`).

- [ ] **Step 2: Create `tests/note-tools.test.ts`** covering note_list / note_read / note_append / note_search execute against a temp dir passed via `dir`.

- [ ] **Step 3: Run `pnpm test`** — all pass.

- [ ] **Step 4: Commit** with `--trailer "Co-authored-by: Shyboy0499 <129135725+Shyboy0499@users.noreply.github.com>"`.

---

### Task 5: README rewrite

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite `README.md`** to match the actual simple agent-notes tool (replace the current "cross-editor writing assistant" description). Content: title, short description, Features table (note_read/list/append/search), Installation (`dsh plugin ... add dsh-note`), each tool's input/output, Development (pnpm scripts).

- [ ] **Step 2: Commit** with co-author trailer to the owner.

---

## Self-Review

**Spec coverage:** four tools (read/list/append/search) → Task 1 (fs ops), Task 2 (tools), Task 3 (entry), Task 4 (tests), Task 5 (README), Task 0 (scaffold). ✅
**Placeholder scan:** each task has concrete code + exact commands. The test task intentionally gives the pairing partner freedom on exact assertions (it is authored by them), but names the files and the behaviors to cover. ✅
**Type consistency:** `resolveNotesDir(cwd, dir)`, `listNotes(dir): NoteFile[]`, `readNote(dir,name,maxChars?)`, `appendNote(dir,name,content)`, `searchNotes(dir,term): NoteHit[]` are consistent across notes.ts, note-tools.ts, and the tests described. Tool output schemas match the shapes returned by execute. ✅
