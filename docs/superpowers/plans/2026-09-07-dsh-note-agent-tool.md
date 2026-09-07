# dsh-note — Agent Memory (token-saving) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the dsh agent durable **memory** in `dsh-note`: it writes short markdown notes (`note_remember`), reads back only what it needs (`note_recall`, tail-capable), lists what it has (`note_list`), and drops what it doesn't need (`note_forget`). The point is **token savings** — the agent keeps context in files instead of re-sending long conversation history.

**Architecture:** A `src/notes.ts` module owns all filesystem operations against a memory directory (default `./notes`, overridable via `dir`), with path-traversal safety via `basename`. Four `defineTool`s in `src/note-tools.ts` wrap remember/recall/list/forget. Entry `src/index.ts` registers them. No network, no LLM calls, no third-party deps — only `node:fs`, `node:path`.

**Tech Stack:** TypeScript, `@deepseek-ai/dsh-tools` `defineTool` API, pnpm, vitest, oxlint, tsdown. Node 18+.

---

## File Structure

- `src/notes.ts` — **new.** `resolveMemoryDir(cwd, dir?)`, `listNotes`, `readNote` (with `tail`), `appendNote`, `deleteNote`. Sync `node:fs`, readable errors, path-safe.
- `src/note-tools.ts` — **new.** `note_remember`, `note_recall`, `note_list`, `note_forget` (`defineTool`s).
- `src/index.ts` — **new.** Registers the four tools (`name = "note"`, `inject = ["tools"]`).
- `tests/notes.test.ts` + `tests/note-tools.test.ts` — **new.** Pairing-partner task.
- Config files (`package.json`, `tsconfig.json`, `tsdown.config.ts`, `.gitignore`, `.prettierrc.json`, `.oxlintrc.json`, `cordis.patch.yml`, `SECURITY.md`, `LICENSE`, `.github/workflows/ci.yml`) — **copy** from `dsh-git-tools`, rename to `dsh-note`.

---

### Task 0: Scaffold config

**Files:** copy the reference config from `dsh-git-tools` (`/Users/brocode/uni/github/dsh-git-tools`), renaming package/entry to `dsh-note`.

- [ ] **Step 1:** Copy `tsconfig.json`, `tsdown.config.ts` (name `dsh-note`, entry `src/index.ts`), `.prettierrc.json`, `.oxlintrc.json`, `.gitignore`, `cordis.patch.yml`, `SECURITY.md`, `.github/workflows/ci.yml`.
- [ ] **Step 2:** Write `package.json` (name `dsh-note`, pin `@deepseek-ai/dsh-tools` = `0.1.0-rc.8`, same devDeps/scripts as reference) and `LICENSE` (MIT).
- [ ] **Step 3:** Run `pnpm install`, `pnpm typecheck`, `pnpm lint` → pass.
- [ ] **Step 4:** Commit (co-author with owner): `git commit -m "chore: scaffold dsh-note plugin" --trailer "Co-authored-by: <owner>"`.

---

### Task 1: src/notes.ts — filesystem memory operations

**Files:** create `src/notes.ts`.

```ts
import { promises as fs } from "node:fs";
import { basename, join, resolve, isAbsolute } from "node:path";

export interface NoteFile { name: string; path: string; title?: string }
export const EXTENSIONS = [".md", ".markdown", ".txt"] as const;

export function resolveMemoryDir(cwd: string | undefined, requestedDir?: string): string {
  const base = requestedDir && isAbsolute(requestedDir)
    ? requestedDir
    : join(cwd ?? process.cwd(), requestedDir ?? "notes");
  return resolve(base);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function listNotes(dir: string): Promise<NoteFile[]> {
  await ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((e) => e.isFile() && EXTENSIONS.includes((e.name.match(/\.\w+$/) ?? [""])[0].toLowerCase() as never))
    .map((e) => e.name)
    .sort();
  const out: NoteFile[] = [];
  for (const name of names) {
    const path = join(dir, name);
    const text = await fs.readFile(path, "utf8");
    const m = text.match(/^#\s+(.+)$/m);
    out.push({ name, path, title: m?.[1]?.trim() });
  }
  return out;
}

export async function readNote(dir: string, name: string, tail?: number): Promise<string> {
  const path = join(dir, basename(name));
  const text = await fs.readFile(path, "utf8");
  if (tail == null) return text;
  const chars = Math.min(Math.max(1, Math.round(tail)), 100_000);
  return text.length <= chars ? text : `…${text.slice(-chars)}`;
}

export async function appendNote(dir: string, name: string, content: string): Promise<{ name: string; path: string }> {
  await ensureDir(dir);
  const path = join(dir, basename(name));
  let existing = "";
  try { existing = await fs.readFile(path, "utf8"); } catch { /* new note */ }
  const next = existing ? existing.trimEnd() + "\n\n---\n\n" + content.trim() : content.trim();
  await fs.writeFile(path, next + "\n", "utf8");
  return { name: basename(name), path };
}

export async function deleteNote(dir: string, name: string): Promise<boolean> {
  const path = join(dir, basename(name));
  try { await fs.unlink(path); return true; } catch { return false; }
}
```

- [ ] **Step 1:** Write `src/notes.ts` as above.
- [ ] **Step 2:** `pnpm typecheck`, `pnpm lint` → pass (drop unused imports if flagged).
- [ ] **Step 3:** Commit (co-author owner).

---

### Task 2: src/note-tools.ts — the four memory tools

**Files:** create `src/note-tools.ts`.

Behavior per tool:
- `note_remember({ name, content, dir? })` → `appendNote`; errors if no content. Returns `{ name }`.
- `note_recall({ name, tail?, dir? })` → `readNote` (with optional `tail`); errors if missing name. Returns `{ name, content }`.
- `note_list({ dir? })` → `{ notes: NoteFile[] }`.
- `note_forget({ name, dir? })` → `deleteNote`; returns `{ name, removed: boolean }`.

All `defineTool`s declare matching JSON output schemas + a plain-text `render`. `dir` resolves via `resolveMemoryDir` using the exec `cwd` when present. Provide readable errors ("A note name is required", etc.).

- [ ] **Step 1:** Write `src/note-tools.ts`.
- [ ] **Step 2:** `pnpm typecheck`, `pnpm lint` → pass.
- [ ] **Step 3:** Commit (co-author owner).

---

### Task 3: src/index.ts — entry

```ts
import type { Context } from "@deepseek-ai/cordis";
import { noteRememberTool, noteRecallTool, noteListTool, noteForgetTool } from "./note-tools";

export const name = "note";
export const inject = ["tools"];

export function apply(ctx: Context) {
  ctx.tools.register(noteRememberTool);
  ctx.tools.register(noteRecallTool);
  ctx.tools.register(noteListTool);
  ctx.tools.register(noteForgetTool);
}
```

- [ ] **Step 1:** Write `src/index.ts`.
- [ ] **Step 2:** `pnpm build` → `lib/index.js` builds.
- [ ] **Step 3:** Commit (co-author owner).

---

### Task 4: Tests (pairing partner)

**Files:** `tests/notes.test.ts`, `tests/note-tools.test.ts` — authored by the **pairing partner** (jingchangzhao-gif) with `Co-authored-by: Shyboy0499`.

Cover, using a temp dir (`fs.mkdtemp(join(os.tmpdir(), "dsh-note-"))`):
- `notes.test.ts`: appendNote creates + appends with `---`; readNote returns full or `tail`-truncated text; listNotes filters extensions + sorts + reads `#` title; deleteNote removes and returns false when absent; path traversal is blocked (`name: "../evil.md"` stays inside the dir via `basename`).
- `note-tools.test.ts`: each tool executes against a temp `dir`, checks output shape + readable errors (missing name/content).

- [ ] **Step 1:** Write tests.
- [ ] **Step 2:** `pnpm test` → all pass.
- [ ] **Step 3:** Commit (co-author Shyboy0499).

---

### Task 5: README final pass

- [ ] **Step 1:** Ensure `README.md` describes the **memory** framing (remember/recall/list/forget + token-saving rationale). It's already rewritten to this framing; verify it matches the final tool names/behavior.
- [ ] **Step 2:** Commit any diff (co-author owner).

---

### Task 6: Cross-platform CLI launcher

> Windows + macOS in one codebase: a Node `cli.mjs` is the real logic; `.bat` and `.command` are 2–3 line shells that call it. `node:path` already handles `\` vs `/`.

**Files:**
- Create: `cli.mjs`
- Create: `run.bat` (Windows shell)
- Create: `run.command` (macOS shell)
- Modify: `package.json` (add `"bin": { "dsh-note": "./cli.mjs" }`)

- [ ] **Step 1: Create `cli.mjs`**

```js
// Cross-platform launcher for dsh-note memory.
// Usage: node cli.mjs [notes-directory]
import { resolveMemoryDir, listNotes } from "./lib/index.js";

const dir = process.argv[2] ?? "notes";
console.log("Memory in:", resolveMemoryDir(undefined, dir));
for (const note of await listNotes(dir)) {
  console.log(`- ${note.name}${note.title ? ` — ${note.title}` : ""}`);
}
```

- [ ] **Step 2: Create `run.bat`** (Windows)

```bat
@echo off
node cli.mjs %1
```

- [ ] **Step 3: Create `run.command`** (macOS)

```sh
#!/bin/bash
node cli.mjs "$1"
```

Then `chmod +x run.command` so it's double-click runnable on macOS.

- [ ] **Step 4: Modify `package.json`** to add the bin entry:

```json
"bin": { "dsh-note": "./cli.mjs" }
```

- [ ] **Step 5: Verify**

Run `pnpm build` (so `lib/` exists), then `node cli.mjs tests/notes-tmp-dir` prints notes from a dir. Confirm `cli.mjs` imports only the built output.

- [ ] **Step 6: Commit** (co-author owner): `git commit -m "feat: add cross-platform CLI launcher" --trailer "Co-authored-by: <owner>"`.

---

## Self-Review

**Spec coverage:** memory framing → remember/recall/list/forget across Tasks 1–3; tests Task 4; README Task 5; scaffold Task 0. ✅
**Placeholder scan:** concrete code/commands per task. Test task names files + behaviors (authored by partner). ✅
**Type consistency:** `resolveMemoryDir`, `listNotes(dir): NoteFile[]`, `readNote(dir,name,tail?)`, `appendNote(dir,name,content)`, `deleteNote(dir,name): boolean` — consistent in notes.ts, note-tools.ts, tests. Output schemas match execute returns. ✅
