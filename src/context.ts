// Builds a small, bounded context packet from local writing notes and the
// long-term memory bank. This is the free step before any "thinking":
// assembling the packet is pure local file work, so the model only ever pays
// tokens to read and reason over the small relevant chunk — never the whole
// store. When the packet exceeds the budget, whole older parts are dropped so
// the most recent context (memory tail first) survives.

import { recallMemory } from "./memory";
import { readNoteFull, searchNotes, zoneRoot } from "./notes";

export interface ContextOptions {
  /** question or topic; narrows search hits and memory recall */
  focus?: string;
  /** writing-zone note names whose recent tail should be included */
  notes?: string[];
  /** total budget in chars (default 6000, cap 20000) */
  chars?: number;
  /** recent-tail budget per named note (default 1200) */
  tailPerNote?: number;
  /** memory chunk budget in chars (default 2500) */
  memoryChars?: number;
  /** snippet length per search hit (default 240) */
  searchChars?: number;
  cwd?: string;
  /** writing zone override */
  writingDir?: string;
  /** memory zone override */
  memoryDir?: string;
}

export interface ContextResult {
  context: string;
  chars: number;
  /** how many parts were assembled (note tails + search hits + memory) */
  parts: number;
  /** true when parts had to be dropped to respect the budget */
  truncated: boolean;
}

export async function buildContext(options: ContextOptions = {}): Promise<ContextResult> {
  const budget = Math.max(500, Math.min(options.chars ?? 6000, 20_000));
  const tailPerNote = Math.max(200, options.tailPerNote ?? 1200);
  const focus = options.focus?.trim();
  const writing = zoneRoot("writing", options.cwd, options.writingDir);
  const memory = zoneRoot("memory", options.cwd, options.memoryDir);

  // Assembly order (oldest → newest): named note tails, focus search hits,
  // memory chunk. Trimming below removes from the front of this order.
  const parts: string[] = [];

  for (const rawName of options.notes ?? []) {
    const name = rawName.trim();
    if (!name) continue;
    try {
      const note = await readNoteFull(writing, name);
      const body = note.body.trim();
      if (!body) continue;
      const head = `# ${note.meta.title?.trim() || name}`;
      const tail = body.length > tailPerNote ? `…${body.slice(-tailPerNote)}` : body;
      parts.push(`${head}\n${tail}`);
    } catch {
      // missing note: skip silently
    }
  }

  if (focus) {
    const hits = await searchNotes(writing, focus, {
      limit: 3,
      snippetChars: options.searchChars ?? 240,
    });
    for (const hit of hits) {
      parts.push(`# ${hit.title ?? hit.name}\n${hit.snippet}`);
    }
  }

  const recall = await recallMemory(
    memory,
    focus
      ? { query: focus, chars: options.memoryChars ?? 2500, limit: 30 }
      : { chars: options.memoryChars ?? 2500, limit: 30 },
  );
  if (recall.content) parts.push(`# memory (recent${focus ? `/relevant` : ""})\n${recall.content}`);

  let context = "";
  let truncated = false;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const candidate = context ? `${parts[i]}\n\n${context}` : parts[i];
    if (candidate.length > budget) {
      truncated = true;
      continue;
    }
    context = candidate;
  }

  return { context, chars: context.length, parts: parts.length, truncated };
}
