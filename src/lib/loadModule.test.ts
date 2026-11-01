/**
 * A lazy-module site does nothing while a recovery reload is in flight (B68, 2026-11-01).
 *
 * main.tsx's `vite:preloadError` handler calls preventDefault() when it starts a recovery reload, and Vite then
 * resolves the failed `import()` with `undefined`. Sites that read the module then threw unhandled TypeErrors
 * (language.ts at boot, the toast facade) or showed failure toasts during the reload. loadModule() turns both
 * cases (module undefined, recovery in flight) into null, and every site returns early on null; TypeScript makes
 * each caller handle null (Promise<T | null>), and dynamicImportThenDoesNoWork requires every loader to use it.
 *
 * @mutate src/lib/loadModule.ts |   if (m == null \|\| recoveryReloadInFlight) return null; |   if (m == null) return null;
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

  it("returns null while a recovery reload is in flight, and the module again once it is called off", async () => {
    const { loadModule, setRecoveryReloadInFlight } = await import("@/lib/loadModule");
    setRecoveryReloadInFlight(true);
    expect(await loadModule(async () => ({ a: 1 }))).toBeNull();
    setRecoveryReloadInFlight(false);
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
  it("language.ts: Spanish stays unloaded and `loading` is reset, so the next call loads it", async () => {
    const { setRecoveryReloadInFlight } = await import("@/lib/loadModule");
    const lang = await import("@/lib/i18n/language");
    lang.__resetLangForTests();
    setRecoveryReloadInFlight(true);
    lang.setLang("es");
    await expect(lang.ensureLangLoaded()).resolves.toBeUndefined();
    const english = lang.t("common.cancel" as never);
    setRecoveryReloadInFlight(false);
    await lang.ensureLangLoaded();
    // The second call really loaded the dictionary: `loading` was not left pointing at the null result.
    const es = (await import("@/lib/i18n/es")).es as Record<string, string>;
    const key = Object.keys(es)[0];
    expect(lang.t(key as never)).toBe(es[key]);
    expect(typeof english).toBe("string");
    lang.__resetLangForTests();
  });

  it("sonnerFacade: a toast during the reload neither throws nor shows, and the next toast loads Sonner", async () => {
    const shown: unknown[] = [];
    vi.doMock("sonner-real", () => ({ toast: Object.assign((m: unknown) => shown.push(m), { error: (m: unknown) => shown.push(m), dismiss: () => {} }) }));
    const { setRecoveryReloadInFlight } = await import("@/lib/loadModule");
    const { toast } = await import("@/lib/sonnerFacade");
    setRecoveryReloadInFlight(true);
    expect(() => toast.error("Couldn't load that repair request")).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(shown).toEqual([]);
    setRecoveryReloadInFlight(false);
    toast("next");
    await vi.waitFor(() => expect(shown).toContain("next"));
    vi.doUnmock("sonner-real");
  });

  it("untilReload never settles (a query or React.lazy waits for the reload instead of failing)", async () => {
    const { untilReload } = await import("@/lib/loadModule");
    const r = await Promise.race([untilReload().then(() => "settled", () => "rejected"), new Promise((res) => setTimeout(() => res("pending"), 20))]);
    expect(r).toBe("pending");
  });
});
