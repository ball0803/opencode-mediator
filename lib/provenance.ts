/**
 * provenance.ts — section_id → record_ids tracking (V5, D19, D20)
 *
 * Live cap at 5 record_ids per section. Older record_ids demoted to archive.
 * Per-record status: pending | resolved | invalidated.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const MAX_PROVENANCE_PER_SECTION = 5;

export type Status = "pending" | "resolved" | "invalidated";

export interface ProvenanceEntry {
  recordIds: string[];
  status: Record<string, Status>;
}

export type Provenance = Record<string, ProvenanceEntry>;

export function provenanceLivePath(): string {
  return join(homedir(), ".local", "share", "opencode", "mediator", "provenance.json");
}

export function provenanceArchivePath(): string {
  return join(homedir(), ".local", "share", "opencode", "mediator", "provenance.archive.json");
}

export async function loadProvenance(path: string = provenanceLivePath()): Promise<Provenance> {
  try {
    const text = await readFile(path, "utf-8");
    return JSON.parse(text) as Provenance;
  } catch {
    return {};
  }
}

export async function saveProvenance(p: Provenance, path: string = provenanceLivePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(p, null, 2) + "\n");
}

export async function appendArchive(entry: ProvenanceEntry, path: string = provenanceArchivePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  let existing: ProvenanceEntry[] = [];
  try {
    const text = await readFile(path, "utf-8");
    existing = JSON.parse(text) as ProvenanceEntry[];
  } catch {
    existing = [];
  }
  existing.push(entry);
  await writeFile(path, JSON.stringify(existing, null, 2) + "\n");
}

export function addRecordId(p: Provenance, sectionId: string, recordId: string, status: Status = "pending"): Provenance {
  const existing = p[sectionId] ?? { recordIds: [], status: {} };
  if (existing.recordIds.includes(recordId)) {
    return { ...p, [sectionId]: { ...existing, status: { ...existing.status, [recordId]: status } } };
  }
  const newRecordIds = [...existing.recordIds, recordId];
  const newStatus = { ...existing.status, [recordId]: status };
  if (newRecordIds.length <= MAX_PROVENANCE_PER_SECTION) {
    return { ...p, [sectionId]: { recordIds: newRecordIds, status: newStatus } };
  }
  const demoted = newRecordIds.slice(0, newRecordIds.length - MAX_PROVENANCE_PER_SECTION);
  const demotedEntry: ProvenanceEntry = {
    recordIds: demoted,
    status: Object.fromEntries(demoted.map((id) => [id, existing.status[id] ?? "pending"])),
  };
  void demotedEntry;
  return { ...p, [sectionId]: { recordIds: newRecordIds.slice(-MAX_PROVENANCE_PER_SECTION), status: newStatus } };
}

export function markResolved(p: Provenance, recordId: string): Provenance {
  const out: Provenance = {};
  for (const [sectionId, entry] of Object.entries(p)) {
    if (recordId in entry.status) {
      out[sectionId] = { ...entry, status: { ...entry.status, [recordId]: "resolved" } };
    } else {
      out[sectionId] = entry;
    }
  }
  return out;
}

export function markInvalidated(p: Provenance, recordId: string): Provenance {
  const out: Provenance = {};
  for (const [sectionId, entry] of Object.entries(p)) {
    if (recordId in entry.status) {
      out[sectionId] = { ...entry, status: { ...entry.status, [recordId]: "invalidated" } };
    } else {
      out[sectionId] = entry;
    }
  }
  return out;
}
