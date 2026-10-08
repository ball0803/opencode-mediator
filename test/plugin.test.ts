import { test, expect, describe, beforeEach } from "bun:test";
import { LatMdEnforcePlugin } from "../.opencode/plugins/lat-md-enforce.ts";

type ToolHook = (input: { tool: string; sessionID: string; args?: unknown }) => Promise<void>;

async function getHooks() {
  const hooks = await (LatMdEnforcePlugin as unknown as (ctx: unknown) => Promise<Record<string, ToolHook>>)({});
  return hooks;
}

describe("lat-md-enforce plugin (Phase 2)", () => {
  let hooks: Record<string, ToolHook>;
  let sessionId: string;

  beforeEach(async () => {
    hooks = await getHooks();
    sessionId = `test-session-${Math.random().toString(36).slice(2, 10)}`;
  });

  test("blocks Edit on a fresh session (no lat.md consult yet)", async () => {
    await expect(
      hooks["tool.execute.before"]!({ tool: "edit", sessionID: sessionId, args: { filePath: "/tmp/x.ts" } }),
    ).rejects.toThrow(/lat-md-enforce/);
  });

  test("blocks Write on a fresh session", async () => {
    await expect(
      hooks["tool.execute.before"]!({ tool: "write", sessionID: sessionId, args: {} }),
    ).rejects.toThrow(/lat-md-enforce/);
  });

  test("blocks MultiEdit on a fresh session", async () => {
    await expect(
      hooks["tool.execute.before"]!({ tool: "multiedit", sessionID: sessionId, args: {} }),
    ).rejects.toThrow(/lat-md-enforce/);
  });

  test("blocks apply_patch on a fresh session", async () => {
    await expect(
      hooks["tool.execute.before"]!({ tool: "apply_patch", sessionID: sessionId, args: {} }),
    ).rejects.toThrow(/lat-md-enforce/);
  });

  test("does NOT block a lat.md consult tool itself (mcp__lat-md__)", async () => {
    await expect(
      hooks["tool.execute.before"]!({ tool: "mcp__lat-md__lat_search", sessionID: sessionId, args: {} }),
    ).resolves.toBeUndefined();
  });

  test("does NOT block a non-mutating tool on a fresh session", async () => {
    await expect(
      hooks["tool.execute.before"]!({ tool: "read", sessionID: sessionId, args: {} }),
    ).resolves.toBeUndefined();
  });

  test("allows Edit after a lat.md consult on the same session", async () => {
    await hooks["tool.execute.before"]!({ tool: "mcp__lat-md__lat_search", sessionID: sessionId, args: { query: "test" } });
    await expect(
      hooks["tool.execute.before"]!({ tool: "edit", sessionID: sessionId, args: { filePath: "/tmp/x.ts" } }),
    ).resolves.toBeUndefined();
  });

  test("allows Write after a lat.md consult on the same session", async () => {
    await hooks["tool.execute.before"]!({ tool: "lat-md_lat_locate", sessionID: sessionId, args: {} });
    await expect(
      hooks["tool.execute.before"]!({ tool: "write", sessionID: sessionId, args: {} }),
    ).resolves.toBeUndefined();
  });

  test("isolates state per session (other session still blocked)", async () => {
    const otherId = `other-session-${Math.random().toString(36).slice(2, 10)}`;
    await hooks["tool.execute.before"]!({ tool: "mcp__lat-md__lat_search", sessionID: sessionId, args: {} });
    await expect(
      hooks["tool.execute.before"]!({ tool: "edit", sessionID: sessionId, args: {} }),
    ).resolves.toBeUndefined();
    await expect(
      hooks["tool.execute.before"]!({ tool: "edit", sessionID: otherId, args: {} }),
    ).rejects.toThrow(/lat-md-enforce/);
  });
});
