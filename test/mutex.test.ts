import { test, expect, describe } from "bun:test";
import { KeyedMutex } from "../lib/mutex.ts";

describe("KeyedMutex", () => {
  test("serializes tasks for the same key", async () => {
    const mutex = new KeyedMutex();
    const order: number[] = [];
    const tasks: Promise<void>[] = [];

    for (let i = 0; i < 5; i++) {
      const idx = i;
      tasks.push(
        mutex.withKey("approval_gate", async () => {
          await new Promise((r) => setTimeout(r, 10));
          order.push(idx);
        }),
      );
    }
    await Promise.all(tasks);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  test("does NOT block different keys", async () => {
    const mutex = new KeyedMutex();
    let aStarted = false;
    let bFinished = false;
    const aDone = mutex.withKey("section_a", async () => {
      aStarted = true;
      await new Promise((r) => setTimeout(r, 50));
    });
    const bDone = mutex.withKey("section_b", async () => {
      expect(aStarted).toBe(true);
      bFinished = true;
    });
    await Promise.all([aDone, bDone]);
    expect(bFinished).toBe(true);
  });

  test("propagates errors and releases the lock", async () => {
    const mutex = new KeyedMutex();
    let secondRan = false;
    await expect(
      mutex.withKey("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await mutex.withKey("k", async () => {
      secondRan = true;
    });
    expect(secondRan).toBe(true);
  });

  test("returns the value from the task", async () => {
    const mutex = new KeyedMutex();
    const result = await mutex.withKey("k", async () => 42);
    expect(result).toBe(42);
  });

  test("concurrent writes to the same key maintain FIFO order (D22, S6)", async () => {
    const mutex = new KeyedMutex();
    const seen: number[] = [];
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < 50; i++) {
      const idx = i;
      tasks.push(
        mutex.withKey("hot_section", async () => {
          seen.push(idx);
        }),
      );
    }
    await Promise.all(tasks);
    expect(seen).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  test("size() returns the number of distinct keys tracked", () => {
    const mutex = new KeyedMutex();
    expect(mutex.size()).toBe(0);
    void mutex.withKey("a", () => {});
    void mutex.withKey("b", () => {});
    expect(mutex.size()).toBe(2);
  });
});
