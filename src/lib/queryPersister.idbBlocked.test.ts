/**
 * CC-004: with IndexedDB unavailable, idb-keyval throws on every call and the
 * persister's storage adapter let it escape as an unhandled rejection on each
 * cold load (Sentry sees a crash). Every adapter method must absorb it.
 *
 * @mutate src/lib/queryPersister.ts | try {\n      const value = await get<string>(key); | {\n      const value = await get<string>(key);
 * @mutate src/lib/queryPersister.ts | try {\n      await set(key, value); | {\n      await set(key, value);
 * @mutate src/lib/queryPersister.ts | try {\n      await del(key); | {\n      await del(key);
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => {
  const blocked = () => Promise.reject(new DOMException("blocked", "SecurityError"));
  return { get: vi.fn(blocked), set: vi.fn(blocked), del: vi.fn(blocked) };
});

import { persistOptions } from "./queryPersister";

describe("query persister survives blocked IndexedDB (CC-004)", () => {
  it("restore reads as an empty cache instead of throwing", async () => {
    await expect(persistOptions.persister.restoreClient()).resolves.toBeUndefined();
  });
  it("persist and remove do not reject", async () => {
    vi.useFakeTimers();
    persistOptions.persister.persistClient({ timestamp: 0, buster: "", clientState: { mutations: [], queries: [] } });
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    await expect(persistOptions.persister.removeClient()).resolves.toBeUndefined();
  });
});
