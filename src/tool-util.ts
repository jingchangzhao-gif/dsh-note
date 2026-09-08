// Shared helpers for dsh tool implementations.
// Kept separate so note-tools.ts and memory-tools.ts read the same way for
// identical concerns (exec cwd access + argument coercion).

export interface ExecShape {
  agent?: { session?: { header?: { cwd?: string } } };
}

/** Session workspace cwd, when the agent loop provides one. */
export function cwdOf(exec: ExecShape | undefined): string | undefined {
  return exec?.agent?.session?.header?.cwd;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function booleanOf(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
