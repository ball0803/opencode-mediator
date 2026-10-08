/**
 * apply-refiner-patch.ts — hidden tool with permission: "ask" (D18, V7, Q3)
 *
 * The recorder plugin programmatically registers this tool on boot. The tool's
 * execute IS the file-write + commit code in `plugins/patch-apply.ts`.
 *
 * The user's main `~/.config/opencode/opencode.json` is never mutated by the plugin.
 */

import { tool, z } from "@opencode-ai/plugin";

const ApplyRefinerPatchArgsSchema = z.object({
  patch_id: z.string().describe("The Refiner's patch_id (ulid)."),
  ops: z
    .array(
      z.object({
        op: z.enum(["add", "revise", "remove", "reorder"]),
        section_id: z.string(),
        content: z.string().optional(),
        before_section_id: z.string().optional(),
        after_section_id: z.string().optional(),
        provenance: z.array(z.string()),
        rationale: z.string(),
      }),
    )
    .describe("The Refiner's operations against named prompt sections."),
  reason: z.string().describe("A short human-readable reason shown in the permission dialog."),
});

export default tool({
  description:
    "Apply a Refiner patch to the Mediator's prompt. High-risk (remove or refined_count >= 2) requires user approval via opencode's permission dialog. The tool's execute IS the file-write + commit code in plugins/patch-apply.ts.",
  args: ApplyRefinerPatchArgsSchema,
  permission: "ask",
  async execute(args) {
    return {
      delegated: true,
      message:
        "Real execute is in plugins/patch-apply.ts; wired by the opencode plugin loader at runtime. This stub returns success when reached.",
      patch_id: args.patch_id,
      ops_count: args.ops.length,
    };
  },
});
