// Tiny in-process TTL cache. Next's unstable_cache proved unreliable against the
// remote database in this setup, so the hot public reads layer this on top: a
// module-level Map is a real cross-request cache within the running server
// process. Mutations call clearMemo() to drop stale entries immediately; the TTL
// is a backstop so anything missed self-heals quickly.

type Entry = { value: unknown; expires: number };
const store = new Map<string, Entry>();

export async function memo<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

/** Drop cached entries. With no prefix, clears everything. */
export function clearMemo(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
