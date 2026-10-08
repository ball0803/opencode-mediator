/**
 * refiner-allowlist.ts — capability tokens for Refiner spawn (D24, S3)
 *
 * opencode's `hidden: true` frontmatter controls `@` autocomplete, not direct
 * programmatic invocation. To enforce the trust boundary, the recorder plugin
 * adds the spawned Refiner session ID to this allowlist at spawn time. The
 * Refiner's prompt instructs it to refuse if the caller is not allowlisted.
 */

export class RefinerAllowlist {
  private readonly tokens = new Map<string, { sessionId: string; createdAt: number; ttlMs: number }>();

  add(sessionId: string, ttlMs: number = 60 * 60 * 1000): string {
    const token = `rfl_${Math.random().toString(36).slice(2, 18)}`;
    this.tokens.set(token, { sessionId, createdAt: Date.now(), ttlMs });
    return token;
  }

  has(token: string): boolean {
    const entry = this.tokens.get(token);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > entry.ttlMs) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  hasForSession(sessionId: string): boolean {
    const now = Date.now();
    for (const [token, entry] of this.tokens) {
      if (entry.sessionId !== sessionId) continue;
      if (now - entry.createdAt > entry.ttlMs) {
        this.tokens.delete(token);
        continue;
      }
      return true;
    }
    return false;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  revokeBySession(sessionId: string): void {
    for (const [token, entry] of this.tokens) {
      if (entry.sessionId === sessionId) this.tokens.delete(token);
    }
  }

  size(): number {
    return this.tokens.size;
  }
}

export const globalRefinerAllowlist = new RefinerAllowlist();
