import type { Context } from "@deepseek-ai/cordis";
import {
  noteRememberTool,
  noteRecallTool,
  noteListTool,
  noteForgetTool,
} from "./note-tools";

export const name = "note";
export const inject = ["tools"];

export function apply(ctx: Context) {
  ctx.tools.register(noteRememberTool);
  ctx.tools.register(noteRecallTool);
  ctx.tools.register(noteListTool);
  ctx.tools.register(noteForgetTool);
}
