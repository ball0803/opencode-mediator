import { test, expect, describe } from "bun:test";
import { RefinerAllowlist } from "../lib/refiner-allowlist.ts";

describe("refiner-allowlist (D24, S3)", () => {
  test("add returns a token starting with rfl_", () => {
    const list = new RefinerAllowlist();
    const token = list.add("session-1");
    expect(token).toMatch(/^rfl_/);
  });

  test("has returns true for an active token", () => {
    const list = new RefinerAllowlist();
    const token = list.add("session-1");
    expect(list.has(token)).toBe(true);
  });

  test("has returns false for an unknown token", () => {
    const list = new RefinerAllowlist();
    expect(list.has("rfl_unknown")).toBe(false);
  });

  test("revoke removes a token", () => {
    const list = new RefinerAllowlist();
    const token = list.add("session-1");
    list.revoke(token);
    expect(list.has(token)).toBe(false);
  });

  test("revokeBySession removes all tokens for a session", () => {
    const list = new RefinerAllowlist();
    const t1 = list.add("session-1");
    const t2 = list.add("session-1");
    const t3 = list.add("session-2");
    list.revokeBySession("session-1");
    expect(list.has(t1)).toBe(false);
    expect(list.has(t2)).toBe(false);
    expect(list.has(t3)).toBe(true);
  });

  test("expired tokens are no longer valid", async () => {
    const list = new RefinerAllowlist();
    const token = list.add("session-1", 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(list.has(token)).toBe(false);
  });
});
