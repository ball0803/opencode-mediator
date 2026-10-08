/**
 * section-id.ts — section ID derivation (D28, S12)
 *
 * - Slug normalization: lowercase, ASCII-only, hyphens
 * - Collision dedup: append `-2`, `-3` suffix
 * - Reorder op support
 */

const RESERVED_SLUG = /[^a-z0-9-]+/g;

export function slugifyHeader(header: string): string {
  const slug = header
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (slug === "") return "section";
  return slug;
}

export class SectionIdAllocator {
  private readonly seen = new Set<string>();

  allocate(header: string): string {
    const base = slugifyHeader(header);
    if (base === "") return "section";
    if (!this.seen.has(base)) {
      this.seen.add(base);
      return base;
    }
    let n = 2;
    while (this.seen.has(`${base}-${n}`)) n += 1;
    const id = `${base}-${n}`;
    this.seen.add(id);
    return id;
  }

  reset(): void {
    this.seen.clear();
  }
}

export interface SectionHeader {
  readonly id: string;
  readonly header: string;
  readonly level: number;
  readonly body: string;
}

export function parseSections(markdown: string, allocator: SectionIdAllocator = new SectionIdAllocator()): SectionHeader[] {
  const out: SectionHeader[] = [];
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) {
      i += 1;
      continue;
    }
    const level = match[1]!.length;
    const header = match[2]!;
    const id = allocator.allocate(header);
    const bodyLines: string[] = [];
    i += 1;
    while (i < lines.length) {
      const next = lines[i]!;
      if (/^#{1,6}\s+/.test(next)) break;
      bodyLines.push(next);
      i += 1;
    }
    out.push({ id, header, level, body: bodyLines.join("\n") });
  }
  return out;
}

export type ReorderOp =
  | { op: "reorder"; sectionId: string; before: string | null; after: string | null };

export function applyReorder(sections: readonly SectionHeader[], op: ReorderOp): SectionHeader[] {
  const idx = sections.findIndex((s) => s.id === op.sectionId);
  if (idx < 0) return [...sections];
  const target = sections[idx]!;
  const remaining = sections.filter((_, i) => i !== idx);
  if (op.before !== null) {
    const beforeIdx = remaining.findIndex((s) => s.id === op.before);
    if (beforeIdx < 0) return [...sections];
    return [...remaining.slice(0, beforeIdx), target, ...remaining.slice(beforeIdx)];
  }
  if (op.after !== null) {
    const afterIdx = remaining.findIndex((s) => s.id === op.after);
    if (afterIdx < 0) return [...sections];
    return [...remaining.slice(0, afterIdx + 1), target, ...remaining.slice(afterIdx + 1)];
  }
  return [...remaining];
}
