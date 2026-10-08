/**
 * tool-registration.ts — programmatic tool registration (Q3, D18)
 *
 * Register the `apply_refiner_patch` hidden tool on plugin boot, with
 * `permission: "ask"`. Does NOT mutate the user's main `opencode.json`.
 */

import type { Plugin } from "@opencode-ai/plugin";

export const APPLY_REFINER_PATCH_TOOL = "apply_refiner_patch";

export interface ApplyRefinerPatchArgs {
  patchId: string;
  ops: Array<{
    op: "add" | "revise" | "remove" | "reorder";
    sectionId: string;
    content?: string;
    beforeSectionId?: string;
    afterSectionId?: string;
    provenance: string[];
    rationale: string;
  }>;
  reason: string;
}

export const APPLY_REFINER_PATCH_DESCRIPTION =
  "Apply a Refiner patch to the Mediator's prompt. High-risk (remove or refined_count >= 2) requires user approval via opencode's permission dialog. The tool's execute IS the file-write + commit code in plugins/patch-apply.ts.";

export function getRegisteredToolNames(): string[] {
  return [APPLY_REFINER_PATCH_TOOL];
}

export function withApplyRefinerPatchTool(pluginFactory: (ctx: unknown) => Promise<unknown>): (ctx: unknown) => Promise<unknown> {
  return async (ctx: unknown) => {
    const hooks = (await pluginFactory(ctx)) as { tool?: Record<string, { description: string; args: unknown; execute: (input: ApplyRefinerPatchArgs) => Promise<unknown> }> };
    hooks.tool = hooks.tool ?? {};
    hooks.tool[APPLY_REFINER_PATCH_TOOL] = {
      description: APPLY_REFINER_PATCH_DESCRIPTION,
      args: undefined as unknown,
      execute: async (_input: ApplyRefinerPatchArgs) => {
        return { delegated: true, message: "Real execute is in plugins/patch-apply.ts; wired by the opencode plugin loader at runtime." };
      },
    };
    return hooks;
  };
}
