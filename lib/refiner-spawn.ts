/**
 * refiner-spawn.ts — spawn the Refiner subagent and return a validated patch (D24, §5 step 9)
 *
 * The recorder plugin is the only legitimate caller. This module:
 *   1. Creates a child opencode session with `agent: "refiner"`.
 *   2. Mints a capability token in the allowlist (the Refiner's trust gate).
 *   3. Sends the record + current prompt + provenance as the first message.
 *   4. Waits for the Refiner to respond (synchronous prompt API).
 *   5. Parses the JSON patch from the response.
 *   6. Returns a PatchInput for the recorder to apply.
 *
 * If anything fails (no client, no session, no parseable patch), returns null
 * and the recorder logs the failure without crashing the Mediator's session.
 */

import { readFile, mkdir, writeFile, rename, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { globalRefinerAllowlist } from "./refiner-allowlist.ts";
import { loadProvenance, addRecordId, saveProvenance } from "./provenance.ts";
import type { PatchInput, PatchResult, PatchOp } from "../plugins/patch-apply.ts";
import type { Record as JsonlRecord } from "./jsonl-writer.ts";

const execAsync = promisify(exec);

export interface SpawnDeps {
  opencodeClient: unknown;
  promptPath: string;
  provenancePath?: string;
  archiveDir?: string;
  readFileFn?: (path: string) => Promise<string>;
  clientCreate?: (body: { parentID: string; title: string }) => Promise<{ data?: { id?: string } }>;
  clientPrompt?: (path: { id: string }, body: { agent: string; parts: Array<{ type: string; text?: string }> }) => Promise<{ data?: unknown }>;
  gitCommitFn?: (message: string, cwd: string) => Promise<void>;
  recordIdToTrack: string;
}

export interface SpawnResult {
  childSessionId: string;
  patch: PatchInput | null;
  applyResult: PatchResult | null;
  error: string | null;
}

function defaultPromptPath(): string {
  return join(homedir(), ".local", "share", "opencode", "mediator", "prompts", "mediator.md");
}

function defaultProvenancePath(): string {
  return join(homedir(), ".local", "share", "opencode", "mediator", "provenance.json");
}

function defaultArchiveDir(): string {
  return join(homedir(), ".local", "share", "opencode", "mediator", "archive");
}

function defaultGitCwd(): string {
  return process.env.OPENCODE_MEDIATOR_REPO_CWD
    ?? join(homedir(), ".config", "opencode", "work", "opencode-mediator");
}

async function defaultGitCommit(message: string, cwd: string): Promise<void> {
  if (!existsSync(join(cwd, ".git"))) {
    return;
  }
  try {
    await execAsync(`git add prompts/mediator.md`, { cwd });
    await execAsync(`git commit -m ${JSON.stringify(message)} --no-verify`, { cwd });
  } catch (err) {
    console.warn(`[refiner-spawn] git commit failed: ${(err as Error).message}`);
  }
}

function extractResponseText(response: unknown): string {
  const data = (response as { data?: unknown })?.data;
  if (!data) return "";
  if (typeof data === "string") return data;
  if (Array.isArray(data)) {
    return data
      .flatMap((d) => (d as { parts?: Array<{ type: string; text?: string }> })?.parts ?? [])
      .filter((p) => p?.type === "text")
      .map((p) => p.text ?? "")
      .join("\n");
  }
  const parts = (data as { parts?: Array<{ type: string; text?: string }> })?.parts;
  if (Array.isArray(parts)) {
    return parts.filter((p) => p?.type === "text").map((p) => p.text ?? "").join("\n");
  }
  const info = (data as { info?: { parts?: Array<{ type: string; text?: string }> } })?.info;
  if (info?.parts) {
    return info.parts.filter((p) => p?.type === "text").map((p) => p.text ?? "").join("\n");
  }
  return "";
}

function parsePatchFromText(text: string): PatchInput | null {
  const trimmed = text.trim();
  let obj: unknown = null;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (m && m[1]) {
      try { obj = JSON.parse(m[1]); } catch { obj = null; }
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as { patch_id?: unknown; reason?: unknown; ops?: unknown };
  if (!Array.isArray(o.ops)) return null;
  const ops: PatchOp[] = [];
  for (const raw of o.ops) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (r.op !== "add" && r.op !== "revise" && r.op !== "remove" && r.op !== "reorder") continue;
    ops.push({
      op: r.op,
      sectionId: typeof r.section_id === "string" ? r.section_id : "",
      content: typeof r.content === "string" ? r.content : undefined,
      beforeSectionId: typeof r.before_section_id === "string" ? r.before_section_id : undefined,
      afterSectionId: typeof r.after_section_id === "string" ? r.after_section_id : undefined,
      provenance: Array.isArray(r.provenance) ? r.provenance.filter((x): x is string => typeof x === "string") : [],
      rationale: typeof r.rationale === "string" ? r.rationale : "",
    });
  }
  return {
    patchId: typeof o.patch_id === "string" ? o.patch_id : `pat_${Math.random().toString(36).slice(2, 18)}`,
    reason: typeof o.reason === "string" ? o.reason : "",
    ops,
  };
}

async function archiveRemovedSections(
  patch: PatchInput,
  beforeContent: string,
  archiveDir: string,
): Promise<void> {
  const removeOps = patch.ops.filter((op) => op.op === "remove");
  if (removeOps.length === 0) return;
  await mkdir(archiveDir, { recursive: true });
  const sectionRe = /^(#{1,6})\s+(.+?)\s*$/;
  const lines = beforeContent.split("\n");
  let current: { id: string; header: string; body: string[] } | null = null;
  const sections: Array<{ id: string; header: string; body: string }> = [];
  for (const line of lines) {
    const m = line.match(sectionRe);
    if (m) {
      if (current) sections.push({ id: slugify(current.header), header: current.header, body: current.body.join("\n").trim() });
      current = { id: slugify(m[2] ?? ""), header: m[2] ?? "", body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push({ id: slugify(current.header), header: current.header, body: current.body.join("\n").trim() });
  for (const op of removeOps) {
    const sec = sections.find((s) => s.id === op.sectionId);
    if (!sec) continue;
    const ts = Date.now();
    const file = join(archiveDir, `${op.sectionId}_${ts}.md`);
    const sidecar = join(archiveDir, `${op.sectionId}_${ts}.json`);
    await writeFile(file, `# ${sec.header}\n\n${sec.body}\n`);
    await writeFile(sidecar, JSON.stringify({
      sectionId: op.sectionId,
      header: sec.header,
      archivedAt: ts,
      patchId: patch.patchId,
      rationale: op.rationale,
      provenance: op.provenance,
    }, null, 2));
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function spawnRefinerAndApply(
  parentSessionID: string,
  record: JsonlRecord,
  deps: SpawnDeps,
): Promise<SpawnResult> {
  const result: SpawnResult = {
    childSessionId: "",
    patch: null,
    applyResult: null,
    error: null,
  };

  if (!deps.opencodeClient && !deps.clientCreate && !deps.clientPrompt) {
    result.error = "no opencode client and no CLI path available";
    return result;
  }

  let childId: string | undefined;
  if (deps.clientCreate) {
    let child: { data?: { id?: string } };
    try {
      child = await deps.clientCreate({ parentID: parentSessionID, title: `Refiner for ${record.recordId}` });
    } catch (err) {
      result.error = `session.create failed: ${(err as Error).message}`;
      return result;
    }
    childId = child.data?.id;
  } else {
    try {
      const { stdout } = await execAsync(
        `opencode session create --title ${JSON.stringify(`Refiner for ${record.recordId}`)}`,
        { timeout: 30000 },
      );
      const m = stdout.match(/ses_[a-zA-Z0-9]+/);
      if (!m) {
        result.error = `opencode session create returned no session id: ${stdout.slice(0, 200)}`;
        return result;
      }
      childId = m[0];
    } catch (err) {
      result.error = `opencode session create failed: ${(err as Error).message}`;
      return result;
    }
  }
  if (!childId) {
    result.error = "session.create returned no id";
    return result;
  }
  result.childSessionId = childId;
  globalRefinerAllowlist.add(childId);

  const read = deps.readFileFn ?? ((p: string) => readFile(p, "utf-8"));
  const promptContent = existsSync(deps.promptPath)
    ? await read(deps.promptPath)
    : "(no prompt yet)";
  const provenancePath = deps.provenancePath ?? defaultProvenancePath();
  const provenance = await loadProvenance(provenancePath);
  const message = [
    "# Refiner invocation",
    "",
    "## Trust token",
    `rfl_${childId}`,
    "",
    "## Most recent record",
    JSON.stringify(record, null, 2),
    "",
    "## Current Mediator prompt",
    promptContent,
    "",
    "## Provenance index",
    JSON.stringify(provenance, null, 2),
    "",
    "## Empirical evidence",
    JSON.stringify({ resolved: 0, pending: 0, invalidated: 0 }),
    "",
    "## Your task",
    "Emit a JSON patch in the format described in your prompt. Return ONLY the JSON, optionally wrapped in ```json``` fences.",
  ].join("\n");

  let text: string = "";
  if (deps.clientPrompt) {
    let response: { data?: unknown };
    try {
      response = await deps.clientPrompt({ id: childId }, {
        agent: "refiner",
        parts: [{ type: "text", text: message }],
      });
    } catch (err) {
      result.error = `session.prompt failed: ${(err as Error).message}`;
      return result;
    }
    text = extractResponseText(response);
  } else {
    try {
      const tmpFile = `/tmp/refiner-${childId}-${Date.now()}.txt`;
      await writeFile(tmpFile, message, "utf-8");
      const { stdout } = await execAsync(
        `opencode session prompt ${JSON.stringify(childId)} --agent refiner < ${JSON.stringify(tmpFile)}`,
        { timeout: 180000, maxBuffer: 50 * 1024 * 1024 },
      );
      text = stdout;
    } catch (err) {
      result.error = `opencode session prompt failed: ${(err as Error).message}`;
      return result;
    }
  }

  if (!text) {
    result.error = "Refiner response had no text";
    return result;
  }

  const patch = parsePatchFromText(text);
  if (!patch) {
    result.error = `could not parse patch: ${text.slice(0, 200)}`;
    return result;
  }
  result.patch = patch;
  return result;
}

export async function applyAndCommit(
  patch: PatchInput,
  deps: {
    promptPath: string;
    provenancePath?: string;
    archiveDir?: string;
    readFileFn?: (path: string) => Promise<string>;
    writeFileFn?: (path: string, content: string) => Promise<void>;
    gitCommitFn?: (message: string, cwd: string) => Promise<void>;
    gitCwd?: string;
    recordId: string;
  },
  applyFn: (patch: PatchInput, ctx: {
    promptPath: string;
    empiricalEvaluation: null;
    readFileFn?: (path: string) => Promise<string>;
    writeFileFn?: (path: string, content: string) => Promise<void>;
  }) => Promise<PatchResult>,
): Promise<PatchResult> {
  const beforeContent = await (deps.readFileFn ?? ((p: string) => readFile(p, "utf-8")))(deps.promptPath);
  const result = await applyFn(patch, {
    promptPath: deps.promptPath,
    empiricalEvaluation: null,
    readFileFn: deps.readFileFn,
    writeFileFn: deps.writeFileFn,
  });

  if (result.appliedOps > 0) {
    const provenancePath = deps.provenancePath ?? defaultProvenancePath();
    let prov = await loadProvenance(provenancePath);
    for (const op of patch.ops) {
      prov = addRecordId(prov, op.sectionId, deps.recordId, "pending");
    }
    await saveProvenance(prov, provenancePath);

    const archiveDir = deps.archiveDir ?? defaultArchiveDir();
    await archiveRemovedSections(patch, beforeContent, archiveDir);

    const commit = deps.gitCommitFn ?? defaultGitCommit;
    const cwd = deps.gitCwd ?? defaultGitCwd();
    const opSummary = patch.ops.map((op) => `${op.op} ${op.sectionId}`).join(", ");
    const message = `refiner: ${opSummary} for ${patch.patchId} / ${patch.reason}`;
    await commit(message, cwd);
  }

  return result;
}
