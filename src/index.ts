import type { Context } from "@deepseek-ai/cordis";
import {
  memoryAddTool,
  memoryCompactTool,
  memoryRecallTool,
  memoryRemoveTool,
  memoryUpdateTool,
} from "./memory-tools";
import {
  noteContextTool,
  noteEditTool,
  noteForgetTool,
  noteListTool,
  noteRecallTool,
  noteRememberTool,
  noteSearchTool,
  noteWriteTool,
} from "./note-tools";

export const name = "note";
export const inject = ["tools"];

export function apply(ctx: Context) {
  // writing zone / generic
  ctx.tools.register(noteRememberTool);
  ctx.tools.register(noteRecallTool);
  ctx.tools.register(noteListTool);
  ctx.tools.register(noteWriteTool);
  ctx.tools.register(noteEditTool);
  ctx.tools.register(noteSearchTool);
  ctx.tools.register(noteForgetTool);
  ctx.tools.register(noteContextTool);
  // long-term memory bank
  ctx.tools.register(memoryAddTool);
  ctx.tools.register(memoryRecallTool);
  ctx.tools.register(memoryUpdateTool);
  ctx.tools.register(memoryCompactTool);
  ctx.tools.register(memoryRemoveTool);
}
