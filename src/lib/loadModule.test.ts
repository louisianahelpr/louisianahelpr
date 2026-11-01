/**
 * A lazy-module site does nothing while a recovery reload is in flight (B68, 2026-11-01).
 *
 * main.tsx's `vite:preloadError` handler calls preventDefault() when it starts a recovery reload, and Vite then
 * resolves the failed `import()` with `undefined`. Sites that read the module then threw unhandled TypeErrors
 * (language.ts at boot, the toast facade) or showed failure toasts during the reload. loadModule() turns both
 * Review of b04c978c8f: null ONLY when the module is undefined (the flag can clear without a reload), and
 * untilReload() fails for real (reported) when no reload follows. Every site returns early on null; TypeScript makes
 * each caller handle null (Promise<T | null>), and dynamicImportThenDoesNoWork requires every loader to use it.
 *
 * @mutate src/lib/loadModule.ts |   return m == null ? null : m; |   return m == null \|\| recoveryReloadInFlight ? null : m;
 * @mutate src/lib/loadModule.ts |   if (!v) for (const fail of [...waiters]) fail(); |   void waiters;
 * @mutate src/lib/loadModule.ts | const timer = inFlight ? setTimeout( | const timer = inFlight && false ? setTimeout(
 * @mutate src/lib/loadModule.ts |         unavailableListener?.(err); |         void unavailableListener;
 * @mutate src/lib/i18n/language.ts |         if (!m) {\n          loading = null; |         if (!m) {\n          loading = loading;
 * @mutate src/lib/sonnerFacade.ts |       if (!m) {\n        loading = null;\n        return;\n      } |
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});
afterEach(async () => {
  (await import("@/lib/loadModule")).setRecoveryReloadInFlight(false);
});

describe("loadModule", () => {
  it("returns the module normally", async () => {
    const { loadModule } = await import("@/lib/loadModule");
    expect(await loadModule(async () => ({ a: 1 }))).toEqual({ a: 1 });
  });

  it("returns null when the preload was prevented (Vite resolves the import with undefined)", async () => {
    const { loadModule } = await import("@/lib/loadModule");
    expect(await loadModule(async () => undefined as unknown as { a: number })).toBeNull();
  });

  it("runs normally while the reload flag is on, when the module loaded (the flag can clear without a reload)", async () => {
    const { loadModule, setRecoveryReloadInFlight } = await import("@/lib/loadModule");
    setRecoveryReloadInFlight(true);
    expect(await loadModule(async () => ({ a: 1 }))).toEqual({ a: 1 });
  });

  it("a real load failure still rejects (each site's own catch handles it)", async () => {
    const { loadModule } = await import("@/lib/loadModule");
    await expect(loadModule(async () => { throw new Error("chunk 404"); })).rejects.toThrow("chunk 404");
  });

  it("chunkReload reads and writes the same flag", async () => {
    const lm = await import("@/lib/loadModule");
    const cr = await import("@/lib/chunkReload");
    lm.setRecoveryReloadInFlight(true);
    expect(cr.isRecoveryReloadInFlight()).toBe(true);
    cr.__resetChunkReloadForTests();
    expect(lm.isRecoveryReloadInFlight()).toBe(false);
  });
});

describe("the sites do nothing during a recovery reload (no throw, no toast)", () => {
  it("language.ts: an empty module leaves Spanish unloaded and resets `loading`, so the next call loads it", async () => {
    let empty = 1;
    vi.doMock("@/lib/loadModule", async () => {
      const real = await vi.importActual<typeof import("@/lib/loadModule")>("@/lib/loadModule");
      return { ...real, loadModule: async <T,>(load: () => Promise<T>) => (empty-- > 0 ? null : real.loadModule(load)) };
    });
    const lang = await import("@/lib/i18n/language");
    lang.__resetLangForTests();
    lang.setLang("es");
    await expect(lang.ensureLangLoaded()).resolves.toBeUndefined();
    await lang.ensureLangLoaded();
    // The second call really loaded the dictionary: `loading` was not left pointing at the empty result.
    const es = (await import("@/lib/i18n/es")).es as Record<string, string>;
    const key = Object.keys(es)[0];
    expect(lang.t(key as never)).toBe(es[key]);
    lang.__resetLangForTests();
    vi.doUnmock("@/lib/loadModule");
  });

  it("sonnerFacade: a toast while Sonner comes back empty neither throws nor shows, and the next toast loads it", async () => {
    let empty = 1;
    vi.doMock("@/lib/loadModule", async () => {
      const real = await vi.importActual<typeof import("@/lib/loadModule")>("@/lib/loadModule");
      return { ...real, loadModule: async <T,>(load: () => Promise<T>) => (empty-- > 0 ? null : real.loadModule(load)) };
    });
    const shown: unknown[] = [];
    vi.doMock("sonner-real", () => ({ toast: Object.assign((m: unknown) => shown.push(m), { error: (m: unknown) => shown.push(m), dismiss: () => {} }) }));
    const { toast } = await import("@/lib/sonnerFacade");
    expect(() => toast.error("Couldn't load that repair request")).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(shown).toEqual([]);
    toast("next");
    await vi.waitFor(() => expect(shown).toContain("next"));
    vi.doUnmock("sonner-real");
    vi.doUnmock("@/lib/loadModule");
  });

  it("untilReload waits while the reload is under way (no failure flashes before the page goes)", async () => {
    const { untilReload, setRecoveryReloadInFlight } = await import("@/lib/loadModule");
    setRecoveryReloadInFlight(true);
    const r = await Promise.race([untilReload().then(() => "settled", () => "rejected"), new Promise((res) => setTimeout(() => res("pending"), 20))]);
    expect(r).toBe("pending");
  });

  it("untilReload rejects at once, reported, when no reload is under way", async () => {
    const { untilReload, onModuleUnavailable, ModuleUnavailableError } = await import("@/lib/loadModule");
    const seen: unknown[] = [];
    onModuleUnavailable((e) => seen.push(e));
    await expect(untilReload()).rejects.toBeInstanceOf(ModuleUnavailableError);
    expect(seen).toHaveLength(1);
  });

  it("the reload is called off: pending work rejects and is reported", async () => {
    const { untilReload, onModuleUnavailable, setRecoveryReloadInFlight } = await import("@/lib/loadModule");
    const seen: unknown[] = [];
    onModuleUnavailable((e) => seen.push(e));
    setRecoveryReloadInFlight(true);
    const p = untilReload();
    setRecoveryReloadInFlight(false);
    await expect(p).rejects.toThrow(/called off/);
    expect(seen).toHaveLength(1);
  });

  it("no reload within the timeout: pending work rejects and is reported", async () => {
    vi.useFakeTimers();
    try {
      const { untilReload, onModuleUnavailable, setRecoveryReloadInFlight, UNTIL_RELOAD_TIMEOUT_MS } = await import("@/lib/loadModule");
      expect(UNTIL_RELOAD_TIMEOUT_MS).toBe(10_000);
      const seen: unknown[] = [];
      onModuleUnavailable((e) => seen.push(e));
      setRecoveryReloadInFlight(true);
      const p = untilReload();
      const settled = p.catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(UNTIL_RELOAD_TIMEOUT_MS + 1);
      expect(await settled).toMatch(/no reload within 10 s/);
      expect(seen).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
