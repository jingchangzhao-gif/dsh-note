# dsh-note

![CI](https://github.com/jingchangzhao-gif/dsh-note/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/npm/l/dsh-note)

> Markdown note tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

`dsh-note` is a small, dependency-free DeepSeek Harness plugin that gives the
coding agent lightweight persistent notes in its workspace: read, list, append,
and search markdown files. No network, no LLM calls — just plain files on disk.

## Features

| Tool           | What it does                                                    |
| -------------- | --------------------------------------------------------------- |
| `note_read`    | Read a note's text (optionally capped)                          |
| `note_list`    | List markdown notes in the notes directory (default `./notes`) |
| `note_append`  | Append a block to a note, creating it if missing                |
| `note_search`  | Search notes for a term, returning file:line matches            |

## Installation

```sh
dsh plugin --profile web add dsh-note
```

No API key or external credentials required.

## Tool reference

Notes live in `./notes` under the session workspace by default. Every tool
accepts an optional `dir` override (absolute path) to point elsewhere.

### `note_list`

```json
{ "dir": "./notes" }
```

Returns `{ dir, notes: [{ name, path, title }] }`, sorted by filename. `title`
is the first `# ` heading of each note, if present.

### `note_read`

```json
{ "name": "todo.md", "maxChars": 4000 }
```

Returns `{ name, content }`. `maxChars` caps the returned text (clamped to a
100000 ceiling).

### `note_append`

```json
{ "name": "todo.md", "content": "- [ ] add tests" }
```

Creates the note if missing, otherwise appends after a `---` separator.
Returns `{ name, path }`.

### `note_search`

```json
{ "term": "TODO" }
```

Returns `{ term, hits: [{ name, line, lineText }] }`, case-insensitive, across
all notes.

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
