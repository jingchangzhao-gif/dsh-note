# dsh-note

![CI](https://github.com/jingchangzhao-gif/dsh-note/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/github/license/jingchangzhao-gif/dsh-note)

> Long-term markdown memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) agents — remember, so you don't re-send.

`dsh-note` is the coding agent's **durable memory**. Instead of carrying a long
conversation (and re-paying tokens for it every turn), the agent writes the
important parts to markdown files — decisions, current state, key facts — and
recalls the relevant snippet later. Context stays small and on-demand, which
**saves tokens** over a session.

Dependency-free: plain markdown files on disk, no network, no extra services.

## Features

| Tool            | What it does                                                        |
| --------------- | ------------------------------------------------------------------- |
| `note_remember` | Append a memory snippet to a named note (creating it if missing)   |
| `note_recall`   | Read back a note (full text or just the most recent part)          |
| `note_list`     | List what's in memory (the note files + their first headings)      |
| `note_forget`   | Remove a note / clear a memory entry                               |

The idea: **remember the important stuff, forget the rest, and only pull back
what you need** — so the prompt stays lean and token cost stays low.

## Installation

```sh
dsh plugin --profile web add dsh-note
```

Memory files live in `./notes` under the session workspace by default; every
tool accepts an optional `dir` override.

## Tool reference

### `note_remember`

```json
{ "name": "session", "content": "Decided: use pnpm + merge commits on paired PRs." }
```

Creates the note if missing, otherwise appends after a `---` separator.

### `note_recall`

```json
{ "name": "session", "tail": 2000 }
```

Returns `{ name, content }`. With `tail`, returns only the last N characters —
enough to remember context without loading everything.

### `note_list`

```json
{}
```

Returns `{ notes: [{ name, title }] }`, sorted by filename. Titles come from the
first `# ` heading of each note.

### `note_forget`

```json
{ "name": "session" }
```

Deletes the note file (no-op if it doesn't exist).

## How it saves tokens

1. During work, the agent appends short memory notes (`note_remember`) instead of
   echoing progress into the conversation.
2. On later turns it pulls back only the recent part (`note_recall` with `tail`),
   or searches its memory — never the whole history.
3. Old/unneeded memory is dropped (`note_forget`), keeping stored context small.

## Cross-platform launcher

`dsh-note` runs as a dsh plugin, but the same memory layer also works as a
tiny command-line tool against a folder of notes. To keep it usable on both
**Windows and macOS** without duplicating logic, write the launcher once in
Node and ship thin per-OS shells that call it:

```js
// cli.mjs — runs on Windows and macOS alike
import { resolveMemoryDir, listNotes } from "./lib/index.js"; // built output

const dir = process.argv[2] ?? "notes";
console.log("Memory in:", resolveMemoryDir(undefined, dir));
for (const note of await listNotes(dir)) {
  console.log(`- ${note.name}${note.title ? ` — ${note.title}` : ""}`);
}
```

Windows — `run.bat`:

```bat
@echo off
node cli.mjs %1
```

macOS — `run.command`:

```sh
#!/bin/bash
node cli.mjs "$1"
```

Real logic lives once (in Node); the shells are just 2–3 line launchers, and
`node:path` already handles the platform differences (`\` vs `/`).

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

## License

MIT
