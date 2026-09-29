# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `note_write` takes `createOnly`: a write meant to create a note is refused
  when one of that name already exists, leaving it untouched, instead of
  replacing it and reporting `created: false` after the fact. The CLI's `write`
  takes `--create-only`.
- `note_stats` and `stats` report the zone's tags with how many live notes
  carry each, most used first (counted case-insensitively; archives excluded).
  The tool returns the top 20 plus `moreTags`, so the model can see the tag
  vocabulary before filtering `note_list` or `memory_recall` by it.
- `note_list` filters: `tags` (any of, any case), `type`, `since` (modified
  at/after a date), `sort: "recent"` and `limit` — so "what changed since the
  last session?" is a free listing instead of reading notes. Modification time
  is the file's mtime, reported as `modified` when a recency filter is used.
  The CLI's `list` takes `--tags`, `--type`, `--since`, `--sort` and `--limit`.
- `note_edit` section mode: `section: "<heading>"` with `new` and `mode`
  (`replace` by default, `append` or `prepend`) rewrites one section without
  quoting its old text — the edit side of `note_recall`'s `section`. The CLI
  takes `edit --section <heading> [--mode …] --new <text>`.
- `note_recall` reads part of a note: `outline: true` returns its headings
  with each section's size, and `section: "<heading>"` returns just that
  section (subsections included), so a long structured note costs only the
  part the model needs. A missing heading names the ones that exist; a
  duplicated one is refused. The CLI takes `recall --outline` and
  `recall --section <heading>`. Asking for more than one of tail, compact,
  section and outline at once is now refused (compact used to win silently
  over tail).
- `stats --zone writing|memory`, which `list`, `search`, `map` and `links`
  already had (and the `note_stats` tool takes as `zone`). Without it, asking
  for the memory zone silently sized `./notes`. The text header and `--json`
  name the zone.
- `tests/compatibility.test.ts` guards the declared harness range: it must
  accept every dsh version dsh-note claims and the `@deepseek-ai/dsh-tools` the
  suite runs against, and must refuse 0.2 and later.

### Changed

- **Harness compatibility.** `@deepseek-ai/dsh-tools` is a peer _range_
  (`>=0.1.0-rc.8 <0.2.0-0`) instead of the exact pin `=0.1.0-rc.8`, and the
  suite develops against the current runtime (`@deepseek-ai/dsh-tools`
  `0.1.7-rc.2`, `@deepseek-ai/cordis` `4.0.4`). dsh compares a plugin's
  `@deepseek-ai/dsh*` peers against the _running_ runtime, prereleases
  included, and refuses to install it otherwise — so the pin made dsh-note
  uninstallable on every runtime but 0.1.0-rc.8 (`Plugin dsh-note@0.4.0 is
incompatible with dsh 0.1.7-rc.2`). The surface dsh-note uses is unchanged
  across the line: `defineTool` and its schema DSL, `ctx.tools.register`, and
  `exec.agent.session.header.cwd`.
- README: installation uses a git specifier (`dsh-note` is not published on
  npm), the desktop profile is documented as plugin-manager-only, and the
  declared peers are listed with the versions they were verified against.
- A missing note suggests the ones that were probably meant:
  `Note not found: sesion.md (did you mean session.md?)`. Case, extension and
  folder differences, prefixes and small typos (a swapped pair of letters
  counts as one) are matched, up to three names,
  in every not-found error (`note_recall`/`note_edit`, the memory tools,
  `note_links`, `note_rename`) — so a typo costs no extra listing round trip.

### Fixed

- `memory_compact` with `keep` kept the last N entries in the file rather than
  the newest N by date. An entry backfilled with an earlier `when` lands last
  in the file, so compaction could archive the newest entry and keep the
  backfilled one. Entries are now ranked by their timestamps, the order
  recalls already use.
- `memory_compact` on a nested topic wrote its archive at the zone root, not
  beside the topic as documented: `a/decisions.md` archived into
  `decisions.archive.md`, and compacting `b/decisions.md` then appended its
  entries to that same file. The archive is now `a/decisions.archive.md`.
  Archives already written at the root stay where they are and stay hidden
  from recalls (`type: archive`); new compactions use the sibling path.
- Installation instructions: they said `dsh plugin --profile web add dsh-note`,
  but that forwards to `pnpm` and the package is not on the npm registry, so it
  could not work. The README now documents the checkout path (and the git path,
  with pnpm's build approval caveat).
- `prepare: pnpm build`, so a plugin installed from git builds `lib/` on install
  instead of arriving without it (the directory is git-ignored; pnpm runs
  `prepare` for git-hosted dependencies, and blocks it until `allowBuilds`
  approves it).
- `scripts/check-pack.mjs`, run in CI, fails if the tarball is missing
  `lib/index.js`, `lib/api.js`, `cli.mjs`, `cordis.patch.yml` or
  `package.json`.

- Links inside inline `` `code` `` spans are not links: a `[[note]]` shown as an
  example no longer counts as a broken link, and a rename no longer rewrites it.
- `memory_recall` puts a blank line between one file's section and the next;
  without it the next file's header read as part of the previous entry.
- `note_map` carries `islands` too, so the agent's outline sees the same
  clusters `note_links` reports (0.4.0's changelog said so; now it is true).
- A missing note says `Note not found: <name>` instead of leaking
  `ENOENT: no such file or directory, open '…'` from `recall` and `edit`.
- `note_list` dropped the title, tags and type of a note whose opening `---`
  line carried trailing spaces, although `note_recall` read that front matter
  fine: the listing tested the mark with a stricter pattern than the parser.
  Both now apply the same test.
- `memory_compact` and `memory_remove` on a topic that does not exist leaked
  `ENOENT: no such file or directory, open '…'`. They now say
  `Memory note not found: <name>`, as `memory_update` already did.
- The CLI ignored flags a command does not take, so a typo ran the command on
  its defaults: `memory-compact --older-then 2024-02-15` compacted to the
  newest 20 entries instead of by date. Unknown flags now fail with
  `unknown flag --…` and the usage line, and `memory-compact` refuses
  `--keep` together with `--older-than` (it used to drop `--keep`). The old
  `search --all` is still accepted.
- Front matter written as a YAML list — how Obsidian and basic-memory store
  `tags` and `aliases` — was unreadable, and the next write destroyed it:
  appending to a note with `tags:` followed by `  - coffee` lines rewrote it as
  an empty `tags: ` and dropped every item. Tag filters and alias links missed
  such notes meanwhile, and `tags: [coffee, brewing]` read as one tag. Block
  lists (any key) and flow lists (`tags`, `aliases`, `alias`) now read as the
  usual comma list and are written back in their original style.
- `dsh-note help` printed its Windows examples broken across lines
  (`recall C:` then `otes session.md`): the `\n` in `C:\notes` inside the
  help template was a newline escape. The backslash is escaped now.

## [0.4.0] - 2026-09-20

The mind-map and link layer: an outline the agent can read cheaply, two Mermaid
diagrams a human can look at, a link graph with orphans and islands, and a
rename that keeps the graph intact.

### Added

- `note_map` tool and `map` CLI command: a free outline of a zone — one line per
  file plus each file's newest entry headings, newest first, trimmed to a
  character budget. Headings usually carry the gist, so the outline is often
  enough to choose which file to recall without paying for entry bodies. The
  outline also carries the zone's link structure (`links`, `broken`, `orphans`,
  `islands`), so one call answers "what is here" and "what relates to what".
- `mindmap` CLI command: the same outline as a `mermaid mindmap` block for
  a human to look at (renders on GitHub, Obsidian, VS Code or the dsh GUI).
  Labels are sanitized and capped, so a note title cannot break the diagram.
- `note_links` tool and `links` CLI command: the link graph between notes. With
  a name, what it points at, what points back, and its dangling targets;
  without one, the zone's link count, orphans and every broken target. Markdown
  links and `[[wikilinks]]` both count, while URLs, anchors, absolute paths and
  fenced code blocks are ignored.
- `note_rename` tool and `rename` CLI command: rename or move a note and rewrite
  every link that resolved to it. Wikilinks keep their style, markdown links
  keep their extension, and anchors, `|labels` and titles survive; alias links
  are rewritten too. `--dry-run` reports the plan, an existing target name is
  refused, and a rename to the same name is a no-op.
- Front matter `aliases:` (or the legacy `alias:`) now resolve links: a bare
  `[[adr]]` reaches `decisions.md` when that note lists `aliases: adr`. Aliases
  are tried last, so they can never shadow a real file name, and an alias two
  notes share stays unresolved.
- `note_links` and `links` report **islands**: linked clusters cut off from the
  biggest one, which orphans alone cannot show. A lone note stays an orphan.
- `linkmap` CLI command: the link graph as a Mermaid `flowchart` — notes are
  nodes, links are edges — for a human to look at. Hubs are drawn first, and the
  number of nodes left out is kept in a Mermaid comment, because a 200-node
  hairball is not a map.

### Changed

- `linkmap` now styles what needs attention — orphans dashed, island members
  outlined — and takes `--max N` for the node cap (default 40, ceiling 500)
  instead of a hard-coded 40.

### Fixed

- Link parsing follows the note-taking ecosystem now. `![alt](image.png)` and
  media targets are no longer mistaken for broken note links, `[label](<my
note.md>)` is understood, and a note linking to itself no longer counts as
  connectivity (which hid that nothing else reached it).
- A bare `[[today]]` resolves to a unique file basename — case-insensitively,
  shortest path first — so nested notes are reachable by name. An ambiguous
  name stays unresolved instead of guessing.
- `mindmap` node labels carry names and titles only; entry counts and byte
  sizes were widening every node for information the text map already gives.

## [0.3.0] - 2026-09-19

Hardening and reach: the recall paths were audited end to end, two features
landed (`note_stats`, `export`/`import`), and CI now guards formatting,
coverage and the launchers on three platforms.

### Added

- `note_stats` tool and `stats` CLI command: a free inventory of a zone — live
  files, archives, memory entries, total bytes and the largest file — so a
  recall budget can be chosen knowingly instead of guessed.
- `export` / `import` CLI commands: snapshot a whole zone (nested notes and
  `*.archive.md` included) into one JSON file and write it back. Restoring
  skips files that already exist unless `--force` is given.
- `--zone writing|memory` on CLI `list` and `search`: selects the default
  folder (`./notes` or `./memory`) and the archive rule, matching the tools.
- `pnpm coverage` with v8 thresholds, `pnpm format:check` in CI, and a CI
  matrix covering Linux, macOS and Windows — including a smoke run of
  `run.bat` and `./run.command` on their own platforms.

### Changed

- `memory_recall` leads each file with its `summary` front matter field, so the
  digest `memory_update` stores is readable from the memory zone.
- Memory recalls are ordered by recency **across** topic files. Previously the
  section order followed file names, so an old topic could consume the whole
  `limit` before a recent one was reached.
- `note_context` drops whole parts from the oldest end, as documented.
  Previously a newest-first pass could discard the focus hits and keep an older
  note tail.
- CLI `list` / `search` show writing-zone archives, matching `note_list` /
  `note_search` (the memory view still hides them).
- Nested notes are reported with their zone-relative name (`log/today.md`)
  instead of a bare basename.
- Reading a zone no longer creates it; only a write does.
- Packaging: `docs/workflows.md` ships with the package and `package.json`
  gained the `repository` field. `.gitattributes` normalizes the checkout to
  LF so the formatting check is identical on every OS.

### Fixed

- Notes are written atomically (sibling temp file + rename), so a crash or a
  full disk cannot leave a half-written note.
- A memory entry and its refreshed `updated` stamp are written in one step.
  Previously an entry could sit on disk with a stale timestamp, and the
  rewrite window could drop a concurrent append.
- A leading `---` block with no `key: value` line is body text, not front
  matter. Previously such a block was read as metadata and then **deleted** by
  the next write (`note_edit`, `note_write`, `memory_add`).
- `memory_recall` counts the section header against `chars`, so a reply can no
  longer exceed the requested budget, and it no longer reports `truncated` when
  every matching entry was returned.
- `memory_update` reports `changed: false` for a merge that alters nothing; the
  always-moving `updated` field used to make every merge look like a change.
- `run.command` is committed with the executable bit, so `./run.command` works
  on a fresh clone as the README describes.
- An unreadable file or subdirectory is skipped rather than failing an entire
  listing, recall or search.
- `note_search` documents and tests AND semantics (every query word must
  appear) instead of implying `|` means OR.

### Internal

- Tool-layer tests for the `note_*` / `memory_*` execute paths (validation,
  zone and `dir` overrides, archive visibility, render text), CLI end-to-end
  tests for stdin, the interactive window and `export` / `import`, and a CJK
  case for the `readHead` multi-byte boundary.
- Node is pinned in CI because `tsdown` requires `^22.18 || >=24`; the
  `engines.node >=18` floor describes the published `lib/` output, not the dev
  toolchain.

## [0.2.0] - 2026-09-08

### Added

- Local notes and a long-term memory bank: two zones (`./notes` and
  `./memory`), simple front matter with free `created` / `updated` stamps,
  free keyword search, in-place edit, and tail-first compact recall.
- 13 dsh tools plus a cross-platform CLI launcher (`cli.mjs` with `run.bat` /
  `run.command`) that mirrors them.

## [0.1.0] - 2026-09-07

### Added

- Initial implementation plan and README.
