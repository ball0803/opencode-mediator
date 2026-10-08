import Mutex from "p-mutex";

/**
 * A per-key mutex map. Each key gets its own Mutex so unrelated sections
 * don't block each other; the same key serializes.
 *
 * This is the trust-boundary helper (D22, S6): all chain-mutating event
 * handlers in the recorder plugin must call `withKey(sectionId, fn)` to
 * serialize concurrent mutations. The same key is the same section.
 *
 * Usage:
 *   const mutex = new KeyedMutex();
 *   await mutex.withKey("approval_gate", async () => {
 *     // chain mutation here
 *   });
 */
export class KeyedMutex {
  private readonly mutexes = new Map<string, Mutex>();

  withKey<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    let mutex = this.mutexes.get(key);
    if (!mutex) {
      mutex = new Mutex();
      this.mutexes.set(key, mutex);
    }
    return mutex.withLock(task);
  }

  /** For tests: how many distinct keys are currently tracked. */
  size(): number {
    return this.mutexes.size;
  }
}
