/**
 * Owner decision 11-20 (Home speed for returning members): the saved query cache is read on the entry's first network
 * round (src/boot/persistedCacheEarly.ts) and restored before the first render (queryPersister.ts restorePersistedEarly,
 * called as QueryCacheHydrator.tsx evaluates). Rules (lead, 11-20): a newer answer already in the cache is never
 * replaced by the saved copy; saved data inside its staleTime may show first and refetches once stale; when the read has
 * not answered by the first render, the after-mount restore runs as before.
 *
 * @mutate src/lib/queryPersister.ts |     if (Date.now() - saved.timestamp > persistOptions.maxAge \|\| saved.buster !== persistOptions.buster) return false; |
 * @mutate src/lib/queryPersister.ts |   if (!slot \|\| typeof slot.raw !== "string") return false; |   if (!slot) return false;
 * @mutate src/components/QueryCacheHydrator.tsx |        if (restoredEarly) { |        if (false) {
 * @mutate src/boot/signedInPrefetch.ts |   startPersistedCacheRead(); |
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { PERSISTED_CACHE_EARLY_SLOT, persistOptions, restorePersistedEarly } from "@/lib/queryPersister";
import { KEYVAL_DB, KEYVAL_STORE, PERSISTED_CACHE_EARLY_KEY, PERSISTED_CACHE_KEY, startPersistedCacheRead } from "@/boot/persistedCacheEarly";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const w = window as unknown as Record<string, unknown>;
const KEY = ["home", "probe"];
const MIN = 60_000;

/** A payload exactly as persistQueryClientSave writes it, for one query answered `at` ms ago. */
function saved(data: unknown, agoMs: number, o: { buster?: string; timestamp?: number } = {}) {
  const src = new QueryClient();
  src.setQueryData(KEY, data, { updatedAt: Date.now() - agoMs });
  return JSON.stringify({ buster: o.buster ?? persistOptions.buster, timestamp: o.timestamp ?? Date.now() - agoMs, clientState: dehydrate(src) });
}
const early = (raw: string | null) => {
  w[PERSISTED_CACHE_EARLY_SLOT] = { raw };
};

afterEach(() => {
  w[PERSISTED_CACHE_EARLY_SLOT] = undefined;
  w[`${PERSISTED_CACHE_EARLY_KEY}Started`] = undefined;
});

describe("the saved query cache is restored before the first render when the entry's read has answered", () => {
  it("restores a saved cache, once", () => {
    const qc = new QueryClient();
    early(saved({ n: 1 }, 2 * MIN));
    expect(restorePersistedEarly(qc)).toBe(true);
    expect(qc.getQueryData(KEY)).toEqual({ n: 1 });
    expect(restorePersistedEarly(new QueryClient()), "the string is taken once").toBe(false);
  });

  it("a newer answer already in the cache wins over the saved copy (the entry's prefetch, a finished read)", () => {
    const qc = new QueryClient();
    qc.setQueryData(KEY, { n: "fresh" }, { updatedAt: Date.now() });
    early(saved({ n: "saved" }, 10 * MIN));
    expect(restorePersistedEarly(qc)).toBe(true);
    expect(qc.getQueryData(KEY)).toEqual({ n: "fresh" });
  });

  it("saved data past its staleTime is refetched, and the fresh answer replaces it", async () => {
    const qc = new QueryClient();
    early(saved({ n: "saved" }, 10 * MIN));
    restorePersistedEarly(qc);
    expect(await qc.fetchQuery({ queryKey: KEY, queryFn: async () => ({ n: "fresh" }), staleTime: MIN })).toEqual({ n: "fresh" });
    expect(qc.getQueryData(KEY)).toEqual({ n: "fresh" });
  });

  it("not answered yet, nothing stored, expired, busted or unreadable: nothing restored, the after-mount restore decides", () => {
    const cases: [string, () => void][] = [
      ["not answered", () => { w[PERSISTED_CACHE_EARLY_SLOT] = undefined; }],
      ["nothing stored", () => early(null)],
      ["expired", () => early(saved({ n: 1 }, persistOptions.maxAge + MIN))],
      ["busted", () => early(saved({ n: 1 }, MIN, { buster: "old-build" }))],
      ["no timestamp", () => early(JSON.stringify({ buster: persistOptions.buster, clientState: { queries: [], mutations: [] } }))],
      ["unreadable", () => early("{not json")],
    ];
    expect(cases.length).toBeGreaterThan(5);
    for (const [why, set] of cases) {
      set();
      const qc = new QueryClient();
      expect(restorePersistedEarly(qc), why).toBe(false);
      expect(qc.getQueryData(KEY), why).toBeUndefined();
    }
  });
});

describe("the entry's early read", () => {
  /** A minimal IndexedDB: one database with idb-keyval's store holding `stored`, or none (`exists: false`). */
  function fakeIdb(stored: unknown, exists = true) {
    const made: string[] = [];
    let closed = false;
    const db = {
      createObjectStore: (n: string) => made.push(n),
      transaction: (store: string) => {
        if (!exists && !made.includes(store)) throw new Error("NotFoundError");
        return {
          objectStore: () => ({
            get: (key: string) => {
              const req: { result?: unknown; onsuccess?: () => void } = {};
              queueMicrotask(() => {
                req.result = key === PERSISTED_CACHE_KEY ? stored : undefined;
                req.onsuccess?.();
              });
              return req;
            },
          }),
        };
      },
      close: () => {
        closed = true;
      },
    };
    const opened: string[] = [];
    const idb = {
      open: (name: string) => {
        opened.push(name);
        const req: { result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void } = { result: db };
        queueMicrotask(() => {
          if (!exists) req.onupgradeneeded?.();
          req.onsuccess?.();
        });
        return req;
      },
    };
    return { idb, opened, made, isClosed: () => closed };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("reads idb-keyval's store and key, hands the string over, and closes its connection", async () => {
    const f = fakeIdb("payload");
    const real = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", { value: f.idb, configurable: true });
    try {
      startPersistedCacheRead();
      expect(w[PERSISTED_CACHE_EARLY_SLOT], "absent while in flight").toBeUndefined();
      await settle();
      expect(w[PERSISTED_CACHE_EARLY_SLOT]).toEqual({ raw: "payload" });
      expect(f.opened).toEqual([KEYVAL_DB]);
      expect(f.isClosed()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { value: real, configurable: true });
    }
  });

  it("a first-ever visit creates idb-keyval's store (so idb-keyval still finds it) and hands over nothing", async () => {
    const f = fakeIdb(undefined, false);
    const real = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", { value: f.idb, configurable: true });
    try {
      startPersistedCacheRead();
      await settle();
      expect(f.made).toEqual([KEYVAL_STORE]);
      expect(w[PERSISTED_CACHE_EARLY_SLOT]).toEqual({ raw: null });
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { value: real, configurable: true });
    }
  });

  it("names agree with idb-keyval's defaults, queryPersister's key and its slot; the hydrator restores before it renders", () => {
    expect(PERSISTED_CACHE_EARLY_KEY).toBe(PERSISTED_CACHE_EARLY_SLOT);
    expect(code("src/lib/queryPersister.ts")).toContain(`const PERSIST_CACHE_KEY = "${PERSISTED_CACHE_KEY}";`);
    const idbKeyval = readFileSync(resolve(ROOT, "node_modules/idb-keyval/dist/index.js"), "utf8");
    expect(idbKeyval).toContain(`createStore('${KEYVAL_DB}', '${KEYVAL_STORE}')`);
    const hydrator = code("src/components/QueryCacheHydrator.tsx");
    expect(hydrator).toMatch(/^const restoredEarly = restorePersistedEarly\(queryClient\);$/m);
    expect(code("src/boot/signedInPrefetch.ts")).toContain("startPersistedCacheRead();");
  });
});
