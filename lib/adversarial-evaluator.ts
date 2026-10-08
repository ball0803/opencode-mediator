/**
 * adversarial-evaluator.ts — second-LLM critic layer (D17, V6, Q1)
 *
 * - Lazy-init detection of `oracle` / `momus` from oh-my-opencode
 * - Session-scoped WeakSet to avoid repeated lookups for routine add/revise
 * - Falls back to built-in critic prompt when neither agent is detected
 * - Triggered only on `op: "remove"` and `refined_count >= 2`
 */

const BUILTIN_CRITIC_PROMPT = `You are a critic. Your job is to find weaknesses in a proposed patch
to a Mediator's prompt. You are NOT a helpful assistant. You are
skeptical. The patch's author is biased toward thinking it is good;
you are the counterweight.

Look for:
1. Sections that contradict what the input records show.
2. Sections whose rationale does not cite a real failure mode.
3. Sections that will make the model more pedantic, crude, or paranoid.
4. Sections whose negative-framing ratio exceeds 0.5.
5. Sections that duplicate behavior already covered by other sections.

Reply in JSON:
{
  "verdict": "approve" | "reject" | "suggest-changes",
  "issues": [{ "section_id": "...", "concern": "..." }],
  "patch_revision": { "ops": [...] }
}`;

export const CRITIC_FALLBACK_PROMPT = BUILTIN_CRITIC_PROMPT;

export type CriticVerdict = "approve" | "reject" | "suggest-changes";

export interface CriticResult {
  verdict: CriticVerdict;
  issues: Array<{ section_id: string; concern: string }>;
  patch_revision?: { ops: unknown[] };
}

export function shouldTrigger(opts: { op: string; refinedCount: number }): boolean {
  return opts.op === "remove" || opts.refinedCount >= 2;
}

export interface AgentLister {
  list(): Promise<string[]>;
}

export class AdversarialEvaluator {
  private readonly resolvedAgents = new WeakSet<object>();

  constructor(
    private readonly agentLister: AgentLister,
    private readonly invokeSubagent: (agent: string, prompt: string) => Promise<CriticResult>,
  ) {}

  async evaluate(opts: { op: string; refinedCount: number; patchJson: string }): Promise<CriticResult> {
    if (!shouldTrigger(opts)) {
      return { verdict: "approve", issues: [] };
    }
    const agents = await this.agentLister.list();
    const reviewer = agents.find((a) => a === "oracle" || a === "momus");
    if (reviewer) {
      return this.invokeSubagent(reviewer, opts.patchJson);
    }
    return this.invokeSubagent("refiner-as-critic", `${BUILTIN_CRITIC_PROMPT}\n\n---\n\nPatch:\n${opts.patchJson}`);
  }
}
