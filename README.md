# dsh-note

![CI](https://github.com/jingchangzhao-gif/dsh-note/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/github/license/jingchangzhao-gif/dsh-note)

> Long-term markdown memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) agents — remember, so you don't re-send.

`dsh-note` is the coding agent's **durable memory**, written in TypeScript with
**zero runtime dependencies**. Instead of carrying a long conversation (and
re-paying tokens for it every turn), the agent keeps the important parts in
local markdown files and recalls only the small relevant chunk later. Context
stays small and on-demand, which **saves tokens** over a session.

**dsh-note itself is token-free** — that is its whole value. Every tool below
is plain local file work (free). Tokens are only spent when the model is
actually asked to think; the note layer just makes that thinking small:
search, tail-reads and bounded context packets instead of whole-file dumps.

## Two zones, never mixed

Storage is split into two directories under the session workspace, so article
writing and long-term memory never get confused (each tool accepts a `dir`
override):

| Zone      | Default dir | What lives there                                                  |
| --------- | ----------- | ----------------------------------------------------------------- |
| `writing` | `./notes`   | working notes, drafts, articles, session logs                     |
| `memory`  | `./memory`  | the long-term memory bank: per-topic files of timestamped entries |

Memory bank files are topic files (e.g. `decisions.md`) whose body is a list
of entries headed `## <ISO timestamp> [title]`. Files can nest inside a zone
(e.g. `log/today.md`); names can never escape the zone root.

## Easy front matter

Memory files (and any note) can start with a simple `---` block:

```markdown
---
title: decisions
tags: tooling, workflow
type: decision
created: 2025-01-03T08:00:00.000Z
updated: 2025-01-05T12:30:00.000Z
summary: compact one-paragraph digest (model-written, on request)
---

## 2025-01-05T12:30:00.000Z — merges

decided: use merge commits on paired PRs
```

- `created`/`updated` timestamps are maintained for free on every write.
- `summary` is optional and is what `compact` recalls show first.
- `type: archive` marks compaction archives, which recalls/search skip.
- Unknown keys are preserved on rewrite; values are plain `key: value` lines.

## Tools

| Tool             | What it does                                                              | Cost |
| ---------------- | ------------------------------------------------------------------------- | ---- |
| `note_remember`  | Append a snippet to a writing note (create if missing)                    | free |
| `note_recall`    | Read a note back — full text, recent `tail`, or `compact` view            | free |
| `note_write`     | **Fully replace** a note's body (updates, rewrites, reordering)           | free |
| `note_edit`      | In-place literal edits of the body, front matter untouched                | free |
| `note_list`      | List a zone's notes with titles / types / tags                            | free |
| `note_search`    | **Free keyword search** across writing/memory/all zones                   | free |
| `note_forget`    | Delete a note file from either zone                                       | free |
| `note_context`   | Assemble the small bounded context around a focus (tail-first)            | free |
| `memory_add`     | Append a timestamped entry to the long-term bank                          | free |
| `memory_recall`  | Recall the recent/relevant **small chunk** (query/tags/type/date filters) | free |
| `memory_update`  | Merge front matter (`summary`/`tags`/…) and/or append an entry            | free |
| `memory_compact` | Keep the newest N entries; move older ones to `*.archive.md`              | free |
| `memory_remove`  | Delete matching entries (deliberate discard, no archive)                  | free |

The actual reasoning features — **summarizing the context above, inferring
what comes next, extracting key information, putting a draft in order** — are
agent workflows that combine these free tools with one deliberate thinking
step. See [`docs/workflows.md`](docs/workflows.md) for ready-to-use recipes.

## How it saves tokens

1. **Small recall**: `note_recall` with `tail`, and `memory_recall` which
   returns newest-first entries bounded by `limit` + a `chars` budget — never
   the whole history.
2. **Free search**: `note_search` is plain local keyword search with snippets,
   so the model can find the right file without scanning everything itself.
3. **Compact fallback**: `note_recall` with `compact` returns the `summary`
   field plus the recent tail. `memory_compact` keeps the active bank small by
   moving old entries into archives. When memory processing would be too long,
   grab the compact version instead.
4. **Edit, not just append**: `note_write`/`note_edit` let the model rewrite a
   note in place — only the text it actually thinks about changes.
5. **Forget the rest**: `note_forget`/`memory_remove` keep stored context
   small, so future prompts stay lean.

## Installation

```sh
dsh plugin --profile web add dsh-note
```

## Tool reference

> These are the dsh plugin tool calls; outside the GUI every one of them has a
> direct CLI equivalent (see [Usage](#usage--runbat--runcommand-point-it-at-a-folder-then-operate)),
> and `docs/workflows.md` shows the reasoning workflows in both forms.

### `note_remember`

```json
{ "name": "session", "content": "Decided: use pnpm + merge commits on paired PRs." }
```

Creates the note if missing, otherwise appends after a `---` separator.

### `note_recall`

```json
{ "name": "session", "tail": 2000 }
```

Returns `{ name, content, truncated }`. With `tail`, only the last N
characters; with `compact: true`, the `summary` field plus the recent ~800
chars.

### `note_write`

```json
{ "name": "article.md", "content": "# New order\n\n…", "tags": "draft" }
```

Replaces the whole body; front matter keys given merge in, others are kept.

### `note_edit`

```json
{ "name": "session.md", "old": "pnpm install", "new": "pnpm i", "all": true }
```

Replaces literal text in the body (never inside front matter).

### `note_list`

```json
{ "zone": "memory" }
```

Lists notes with title/type/tags; archives are hidden from the memory view.

### `note_search`

```json
{ "query": "pnpm merge", "zone": "all" }
```

Returns ranked hits `{ name, title, snippet, score }`. Zero tokens.

### `note_forget`

```json
{ "name": "session.md", "zone": "writing" }
```

### `note_context`

```json
{ "focus": "what should I do next?", "notes": ["session.md"] }
```

Returns one bounded context packet: recent tails of the named notes, search
snippets for the focus, and the recent/relevant memory tail. Older parts are
dropped first when the `chars` budget (default 6000) is tight.

### `memory_add`

```json
{ "content": "user prefers dark mode", "tags": "prefs", "type": "preference" }
```

Appends a `## <ISO timestamp>` entry to `memory.md` (or `name` when given).

### `memory_recall`

```json
{ "query": "dark mode", "limit": 5, "chars": 2000 }
```

Newest-first, bounded. Supports `name`, `tags`, `type`, `newerThan`,
`olderThan`. Without filters it returns just the recent tail of the bank.

### `memory_update`

```json
{ "name": "decisions.md", "meta": { "summary": "digest: …" } }
```

Merges front matter fields; `content` appends an entry.

### `memory_compact`

```json
{ "name": "decisions.md", "keep": 20 }
```

Keeps the 20 newest entries, moves the rest to `decisions.archive.md`
(`type: archive`, invisible to recalls and search).

### `memory_remove`

```json
{ "name": "decisions.md", "match": "superseded idea" }
```

## Usage — run.bat / run.command: point it at a folder, then operate

The launcher is the primary way to use dsh-note. One logic file (`cli.mjs`)
runs on **Windows and macOS alike**; `run.bat` and `run.command` are thin
shells that just forward every argument — so you give the tool a concrete
folder address plus an operation, and the free file work happens locally.
No model, no network, no tokens.

Build once before first use (`cli.mjs` drives the built `lib/`):

```sh
pnpm build
```

Basic shape:

```text
run.bat <command> [dir] [--flags...]
```

- `<dir>` is the folder the command operates on. Plain commands expect the
  notes folder; `memory-*` commands expect the memory-bank folder. When
  omitted, plain commands default to `./notes` and `memory-*` to `./memory`.
- Run `run.bat help` (or `run.bat --help`) for the full reference.

Windows:

```bat
run.bat list "C:\Users\me\notes"
run.bat remember "C:\Users\me\notes" --name session.md --content "decided: pnpm"
run.bat recall  "C:\Users\me\notes" --name session.md --tail 2000
run.bat write   "C:\Users\me\notes" --name article.md --file new-draft.md --title "Article"
run.bat search  "C:\Users\me\notes" --query "pnpm merge"
run.bat memory-add "D:\memory" --content "user prefers dark mode" --tags prefs --type preference
run.bat memory-recall "D:\memory" --query "dark mode"
run.bat memory-compact "D:\memory" --name decisions.md --keep 20
```

macOS is identical with `./run.command` instead of `run.bat`.

| Command                                                                | What it does                                 |
| ---------------------------------------------------------------------- | -------------------------------------------- |
| `list [dir]`                                                           | List note files with title/type/tags         |
| `remember <dir?> --name f [--content \| --file \| -]`                  | Append a block (create if missing)           |
| `recall <dir?> --name f [--tail N] [--compact]`                        | Read full text, recent tail, or compact view |
| `write <dir?> --name f (--content \| --file) [--title/--tags/--type]`  | Fully replace the body                       |
| `edit <dir?> --name f --old x [--new y] [--all]`                       | In-place literal body edit                   |
| `search <dir?> --query words [--limit N] [--all]`                      | Free keyword search with snippets            |
| `forget <dir?> --name f`                                               | Delete a note file                           |
| `context <dir?> [--focus q] [--notes a,b] [--memory <dir>]`            | Assemble a small bounded context packet      |
| `memory-add <dir?> (--content \| --file) [--name] [--tags] [--type]`   | Append a timestamped bank entry              |
| `memory-recall <dir?> [--query] [--tags] [--type] [--limit] [--chars]` | Recall the recent/relevant small chunk       |
| `memory-update <dir?> [--summary etc.] [--content \| --file]`          | Merge front matter / append entry            |
| `memory-compact <dir?> [--name] [--keep N \| --older-than date]`       | Move older entries to `*.archive.md`         |
| `memory-remove <dir?> --match text [--name]`                           | Delete matching entries                      |

Notes:

- Append `--json` to any command to print the structured result.
- `run.bat <dir>` with a single bare argument keeps the legacy launcher form
  (list that directory).
- Quote multi-word values. For Chinese or multiline content, pass `--file
<path>` (UTF-8) or `--content -` and pipe stdin — the shells forward every
  argument unchanged (`%*` / `"$@"`), so byte-exact input stays byte-exact.
- The same package also works as a dsh plugin inside the DeepSeek Harness
  GUI (`dsh plugin --profile web add dsh-note`); the 13 tools then mirror the
  commands above.

## Development

```sh
pnpm install
pnpm typecheck
pnpm build   # build first: the CLI and its end-to-end tests run against lib/
pnpm test
pnpm lint
```

## License

MIT
