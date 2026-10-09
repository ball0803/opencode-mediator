/**
 * patch-schema.ts — Hand-rolled validation for Refiner patches.
 */

export interface PatchOp {
  op: "add" | "revise" | "remove" | "reorder";
  section_id: string;
  content?: string;
  before_section_id?: string;
  after_section_id?: string;
  provenance: string[];
  rationale: string;
}

export interface Patch {
  patch_id: string;
  produced_from_records: string[];
  ops: PatchOp[];
  reason?: string;
}

const VALID_OPS = new Set(["add", "revise", "remove", "reorder"]);

function fail(path: string, msg: string): never {
  throw new Error(`[patch-schema] ${path}: ${msg}`);
}

function validateOp(value: unknown, path: string): PatchOp {
  if (typeof value !== "object" || value === null) {
    fail(path, "expected object");
  }
  const v = value as Record<string, unknown>;
  if (typeof v["op"] !== "string" || !VALID_OPS.has(v["op"])) {
    fail(`${path}.op`, "must be one of add|revise|remove|reorder");
  }
  if (typeof v["section_id"] !== "string" || v["section_id"].length === 0) {
    fail(`${path}.section_id`, "must be non-empty string");
  }
  if (v["content"] !== undefined && typeof v["content"] !== "string") {
    fail(`${path}.content`, "must be string when present");
  }
  if (v["before_section_id"] !== undefined && typeof v["before_section_id"] !== "string") {
    fail(`${path}.before_section_id`, "must be string when present");
  }
  if (v["after_section_id"] !== undefined && typeof v["after_section_id"] !== "string") {
    fail(`${path}.after_section_id`, "must be string when present");
  }
  if (!Array.isArray(v["provenance"]) || !v["provenance"].every((p) => typeof p === "string")) {
    fail(`${path}.provenance`, "must be array of strings");
  }
  if (typeof v["rationale"] !== "string" || v["rationale"].length === 0) {
    fail(`${path}.rationale`, "must be non-empty string");
  }
  return {
    op: v["op"] as PatchOp["op"],
    section_id: v["section_id"] as string,
    content: v["content"] as string | undefined,
    before_section_id: v["before_section_id"] as string | undefined,
    after_section_id: v["after_section_id"] as string | undefined,
    provenance: v["provenance"] as string[],
    rationale: v["rationale"] as string,
  };
}

export function parsePatch(value: unknown): Patch {
  if (typeof value !== "object" || value === null) {
    fail("", "expected object");
  }
  const v = value as Record<string, unknown>;
  if (typeof v["patch_id"] !== "string" || v["patch_id"].length === 0) {
    fail("patch_id", "must be non-empty string");
  }
  if (!Array.isArray(v["produced_from_records"]) || !v["produced_from_records"].every((p) => typeof p === "string")) {
    fail("produced_from_records", "must be array of strings");
  }
  if (!Array.isArray(v["ops"])) {
    fail("ops", "must be array");
  }
  const ops = (v["ops"] as unknown[]).map((op, i) => validateOp(op, `ops[${i}]`));
  return {
    patch_id: v["patch_id"] as string,
    produced_from_records: v["produced_from_records"] as string[],
    ops,
    reason: typeof v["reason"] === "string" ? v["reason"] : undefined,
  };
}

export const PatchSchema = { safeParse: (value: unknown) => {
  try {
    return { success: true as const, data: parsePatch(value) };
  } catch (err) {
    return { success: false as const, error: { message: err instanceof Error ? err.message : String(err) } };
  }
}};
