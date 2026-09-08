# dsh-note Agent Workflows (token-minimal recipes)

> Principle reminder: **dsh-note itself is token-free**. Every recipe below
> follows the same pattern — first gather the **small relevant chunk** with
> free tools (`note_search` / `note_recall` / `memory_recall` /
> `note_context`), then do exactly **one real thinking step**; finally store
> the conclusion back with free tools (`note_write` / `note_edit` /
> `memory_add` / `memory_update` / `memory_compact`). Never feed the whole
> store to the model.
>
> In the steps below, `<-- free -->` marks operations that never call a
> model; `<-- the only paid step -->` marks the single model turn that spends
> tokens.

---

## 1. Summarize what happened so far

Scenario: mid-session, you want to compress the current workspace/writing
notes into one summary and store it in memory.

```text
<-- free -->  note_context   { focus: "current progress", notes: ["session.md", "article.md"] }
<-- the only paid step -->  the model reads the returned context packet and writes a ≤150-word summary
<-- free -->  memory_add    { content: "<summary>", name: "session-summary.md", type: "summary" }
```

Key points:

- Do not `note_recall` a whole long note; `note_context` takes each note's
  **tail** first and then trims oldest parts first against the `chars`
  budget, keeping the packet small.
- If one summary is too large, split it into several `note_context` calls
  (each with a different `focus`) and summarize topic by topic.

## 2. Infer what should happen next (continuation direction)

Scenario: an article/task is half-finished and you want to know how to
continue.

```text
<-- free -->  note_context   { focus: "how to continue", notes: ["article.md"] }
<-- the only paid step -->  the model proposes 3 directions plus a recommendation
<-- free -->  note_write    { name: "article.md", content: "<chosen continuation, full text>" }  // or
<-- free -->  note_edit     { name: "article.md", old: "<paragraph to change>", new: "<new paragraph>" }
```

Key points: once the continuation is decided, land it with `note_write`
(full replace) or `note_edit` (targeted replace) — **pay for thinking about
exactly the text that actually changes**.

## 3. Context memory (resume across sessions)

Scenario: a new session continues old work; first, get yourself "back".

```text
<-- free -->  note_list      { zone: "writing" }   // which writing notes exist
<-- free -->  note_list      { zone: "memory" }    // which memory-bank topic files exist
<-- free -->  memory_recall  {}                    // recent tail of the bank (small default budget)
<-- free -->  note_recall    { name: "session.md", tail: 2000 }  // most recent 2000 chars
<-- the only paid step -->  the model assembles "where I am, what's done, what's next" from the chunks
```

Key points: with no arguments, `memory_recall` returns only a **recent tail**
(default 10 entries / 4000 chars), never the whole bank — this is exactly the
"process only a small part of the tail, not everything" constraint.

## 4. Extract key facts

Scenario: pull decisions, facts and highlights out of a draft/long text into
the memory bank.

```text
<-- free -->  note_recall    { name: "article.md", compact: true }  // summary field + recent tail
<-- free -->  note_search    { query: "decided|conclusion|key", zone: "writing" }  // locate key passages
<-- the only paid step -->  the model distills 3–8 structured bullet points
<-- free -->  memory_add     { name: "decisions.md", content: "<points>", tags: "facts", type: "decision" }
```

Key points: for long texts try the `compact` view first; only top up with
`tail` / `search` as needed — never read the whole text aloud.

## 5. Reorder / outline a messy draft

Scenario: the draft's paragraphs are out of order and the logic needs to be
untangled.

```text
<-- free -->  note_recall    { name: "draft.md", tail: 6000 }   // take the recent stretch only
<-- the only paid step -->  the model outputs an ordered outline mapping old paragraphs to new order
<-- free -->  note_write     { name: "draft.md", content: "<full text in the new order>" }
```

Key points: reordering means a full rewrite, and `note_write` does it in one
call; replacing the body never touches front matter, so `title`/`tags` stay
intact.

## 6. Memory hygiene and the compact fallback

Scenario A: the memory file grew too long and processing would time out /
blow the budget — grab the compact version first:

```text
<-- free -->  memory_recall  { name: "decisions.md", limit: 5, chars: 1000 }  // small recall
<-- the only paid step -->  the model condenses those entries into one summary paragraph
<-- free -->  memory_update  { name: "decisions.md", meta: { summary: "<digest>" } }
<-- free -->  note_recall    { name: "decisions.md", compact: true }  // compact view available anytime later
```

Scenario B: the memory file keeps growing — archive for free (content is
moved, never rewritten):

```text
<-- free -->  memory_compact { name: "decisions.md", keep: 20 }
<-- free -->  memory_recall  {}   // afterwards only the newest 20 show; older ones live in decisions.archive.md
```

Scenario C: delete a wrong/outdated memory entry:

```text
<-- free -->  memory_remove  { name: "decisions.md", match: "superseded decision" }
```

Key points: `memory_compact` purely moves text (archival), zero model calls;
real "summary compression" happens only when you ask for it (the paid step
of scenario A).

## 7. CLI equivalents (run.bat / run.command)

Every "free step" in the recipes above can be typed directly at the command
line (`<notes>` is your writing folder, `<memory>` is your memory-bank
folder; on macOS replace `run.bat` with `./run.command`):

| Tool call | Equivalent CLI |
| --- | --- |
| `note_remember` | `run.bat remember <notes> session.md --content "…"` |
| `note_recall` | `run.bat recall <notes> session.md [--tail 2000 \| --compact]` |
| `note_write` | `run.bat write <notes> article.md --file new-draft.md [--title "…"]` |
| `note_edit` | `run.bat edit <notes> session.md --old "old text" --new "new text" [--all]` |
| `note_list` | `run.bat list <dir>` |
| `note_search` | `run.bat search <dir> <query words...>` |
| `note_forget` | `run.bat forget <dir> file.md` |
| `note_context` | `run.bat context <notes> --focus "question" --notes session.md --memory <memory>` |
| `memory_add` | `run.bat memory-add <memory> --content "…" [--name decisions.md] [--tags a,b]` |
| `memory_recall` | `run.bat memory-recall <memory> [--query "…"] [--limit 5] [--chars 2000]` |
| `memory_update` | `run.bat memory-update <memory> --name decisions.md --summary "digest…"` |
| `memory_compact` | `run.bat memory-compact <memory> --name decisions.md --keep 20` |
| `memory_remove` | `run.bat memory-remove <memory> --name memory.md --match "text to drop"` |

Example — recipe 1 ("summarize what happened so far") in CLI form:

```bat
run.bat context C:\notes --focus current-progress --notes session.md --memory D:\memory
rem ↑ outputs the small context packet; let the model read it and write a ≤150-word summary (the only paid step)
run.bat memory-add D:\memory --name session-summary.md --type summary --content "…summary text…"
```

Content tips: quote multi-word values; for non-ASCII or multiline content use
PowerShell with `--content "…"`, or save the text as a UTF-8 file and pass
`--file <path>`; if you write non-ASCII text directly inside a `.bat`, keep
that file UTF-8 and run `chcp 65001` first.

## 8. The zero-token self-check (run through before authoring any recipe)

- [ ] Every file read/write/search/list uses the free tools — nothing goes
      through the model;
- [ ] Before each model "thinking" step, `note_context` / `memory_recall` /
      `note_recall(tail)` delivered a **small and relevant** context chunk;
- [ ] Each recall carries a budget (`chars`) and a limit (`limit`), touching
      only the **recent tail** by default;
- [ ] When memory processing gets too long, switch to the `compact` view or
      `memory_compact` the bank first;
- [ ] Conclusions land via `memory_add` / `note_edit` / `note_write` instead
      of echoing large text back and forth in the conversation;
- [ ] Use `note_search` instead of "read everything to find it", and drop
      stale content with `memory_remove` / `note_forget`.
