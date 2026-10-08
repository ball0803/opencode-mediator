import { test, expect, describe } from "bun:test";
import { shouldTrigger, AdversarialEvaluator, CRITIC_FALLBACK_PROMPT } from "../lib/adversarial-evaluator.ts";

describe("adversarial-evaluator (D17, V6, Q1)", () => {
  describe("shouldTrigger (V6)", () => {
    test("triggers on op: remove", () => {
      expect(shouldTrigger({ op: "remove", refinedCount: 0 })).toBe(true);
    });

    test("triggers on refined_count >= 2", () => {
      expect(shouldTrigger({ op: "add", refinedCount: 2 })).toBe(true);
      expect(shouldTrigger({ op: "revise", refinedCount: 5 })).toBe(true);
    });

    test("does NOT trigger on routine add/revise with refined_count < 2", () => {
      expect(shouldTrigger({ op: "add", refinedCount: 0 })).toBe(false);
      expect(shouldTrigger({ op: "revise", refinedCount: 1 })).toBe(false);
    });
  });

  describe("CRITIC_FALLBACK_PROMPT", () => {
    test("contains the synscribe-derived failure-mode categories", () => {
      expect(CRITIC_FALLBACK_PROMPT).toContain("counterweight");
      expect(CRITIC_FALLBACK_PROMPT).toContain("pedantic");
      expect(CRITIC_FALLBACK_PROMPT).toContain("rationale");
      expect(CRITIC_FALLBACK_PROMPT).toContain("0.5");
    });
  });

  describe("AdversarialEvaluator (lazy-init detect)", () => {
    test("uses oracle when present", async () => {
      const invocations: Array<{ agent: string; prompt: string }> = [];
      const ev = new AdversarialEvaluator(
        { list: async () => ["oracle", "build"] },
        async (agent, prompt) => {
          invocations.push({ agent, prompt });
          return { verdict: "approve", issues: [] };
        },
      );
      const result = await ev.evaluate({ op: "remove", refinedCount: 0, patchJson: "{}" });
      expect(invocations[0]!.agent).toBe("oracle");
      expect(result.verdict).toBe("approve");
    });

    test("uses momus when present and oracle is absent", async () => {
      const invocations: Array<{ agent: string; prompt: string }> = [];
      const ev = new AdversarialEvaluator(
        { list: async () => ["momus", "build"] },
        async (agent, prompt) => {
          invocations.push({ agent, prompt });
          return { verdict: "approve", issues: [] };
        },
      );
      await ev.evaluate({ op: "remove", refinedCount: 0, patchJson: "{}" });
      expect(invocations[0]!.agent).toBe("momus");
    });

    test("falls back to refiner-as-critic when neither oracle nor momus is present", async () => {
      const invocations: Array<{ agent: string; prompt: string }> = [];
      const ev = new AdversarialEvaluator(
        { list: async () => ["build", "lint"] },
        async (agent, prompt) => {
          invocations.push({ agent, prompt });
          return { verdict: "approve", issues: [] };
        },
      );
      await ev.evaluate({ op: "remove", refinedCount: 0, patchJson: "{}" });
      expect(invocations[0]!.agent).toBe("refiner-as-critic");
      expect(invocations[0]!.prompt).toContain(CRITIC_FALLBACK_PROMPT);
    });

    test("skips entirely on routine add/revise with refined_count < 2", async () => {
      const invocations: Array<{ agent: string }> = [];
      const ev = new AdversarialEvaluator(
        { list: async () => ["oracle"] },
        async (agent) => {
          invocations.push({ agent });
          return { verdict: "approve", issues: [] };
        },
      );
      const result = await ev.evaluate({ op: "add", refinedCount: 0, patchJson: "{}" });
      expect(invocations.length).toBe(0);
      expect(result.verdict).toBe("approve");
    });
  });
});
