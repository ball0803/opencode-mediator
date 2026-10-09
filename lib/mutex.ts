/**
 * mutex.ts — Inlined KeyedMutex (no external deps).
 * Per-key promise-chain mutex. Each key gets its own queue so unrelated
 * sections don't block each other; the same key serializes.
 */

class KeyedMutexImpl {
  private readonly queues = new Map<string, Promise<unknown>>();

  withKey<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(() => task(), () => task());
    this.queues.set(key, next.catch(() => {}));
    return next as Promise<T>;
  }

  size(): number {
    return this.queues.size;
  }
}

export const globalMutex = new KeyedMutexImpl();
export const KeyedMutex = KeyedMutexImpl;
