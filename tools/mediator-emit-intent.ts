/**
 * mediator-emit-intent.ts — custom tool the Mediator calls when the user approves
 *
 * The Zod schema is exported from `plugins/recorder.ts` as `WorkingIntentSchema`
 * and re-used here so the tool definition and the plugin's validation stay in sync.
 */

import { z } from "zod";
import { tool } from "@opencode-ai/plugin";

const WorkingIntentArgsSchema = z.object({
  goal: z.string().describe("The user's goal, in their own words where possible."),
  constraints: z.array(z.string()).default([]).describe("Hard constraints the user stated."),
  context: z.string().default("").describe("Background context the user provided."),
  success_criteria: z.array(z.string()).default([]).describe("What 'done' looks like for the user."),
  out_of_scope: z.array(z.string()).default([]).describe("Explicit non-goals."),
  open_questions: z.array(z.string()).default([]).describe("Should be empty before emit."),
});

export default tool({
  description:
    "Emit the locked WorkingIntent. Only call when the user has typed `approve` / `go` / `proceed` / `ship it` or green-lit the summary. The recorder plugin validates the schema and the prior approval before persisting.",
  args: WorkingIntentArgsSchema,
  async execute(args) {
    return { emitted: true, intent: args };
  },
});
