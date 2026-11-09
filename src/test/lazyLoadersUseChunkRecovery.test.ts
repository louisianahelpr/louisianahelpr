/**
 * CLASS GUARD: no on-demand import helper skips the shared stale-chunk recovery (11-09).
 *
 * error_logs e9286ab7, 2026-11-08 22:05Z, /jobs, a real member, release 696580b0dd: "Failed to fetch dynamically
 * imported module: .../assets/dockSheets-D9MaR0It.js", source MobileNav.loadDockSheets. A deploy had changed the
 * chunk's hash. createLazyModule (src/lib/lazyModule.ts) reported every failed import as a member error and retried
 * the dead hashed file on each start(); it never used the recovery in src/lib/chunkReload.ts (isChunkLoadError plus
 * the bounded hard-reload schedule the error boundaries and main.tsx's vite:preloadError use).
 *
 * 1. INVENTORY FROM SOURCE. Every function some non-test file under src/ hands a `() => import(...)` loader to is a
 *    loader helper. Each is classified here, exact both ways (a new helper fails until it is classified; a retired
 *    one fails until it is removed):
 *      hands-off   its own definition calls handOffStaleChunk (or, for loadModule, the hand-off chunkReload.ts
 *                  registers through onStaleChunkLoad), checked against the definition's source below;
 *      render      React.lazy or a wrapper of it: a failure throws into render, where ErrorBoundary,
 *                  SectionBoundary and RouteErrorBoundary run the same recovery
 *                  (src/test/errorBoundariesQuietDuringChunkRecovery.test.tsx);
 *      background  backgroundImport: declines recovery BY DESIGN (Q131: nothing on screen needs that module, and a
 *                  reload for it wiped "Application sent!"; src/lib/backgroundImport.test.ts).
 * 2. BEHAVIOUR, on the real chunkReload.ts: for each hands-off helper, a stale chunk starts the recovery and is not
 *    reported; a stale chunk while a reload is already in flight is quiet and spends no attempt; a stale chunk once
 *    the attempts are spent IS reported, with the decline reason; any other failure is still reported.
 *
 * @mutate src/lib/lazyModule.ts |         if (handOffStaleChunk(err)) return null; |         if (false) return null;
 * @mutate src/lib/optionalLazy.ts |       if (!unavailable && !handOffStaleChunk(err)) { |       if (!unavailable) {
 * @mutate src/lib/loadModule.ts |     if (staleChunkHandoff?.(err)) return null; |     if (false) return null;
 * @mutate src/lib/chunkReload.ts | onStaleChunkLoad(handOffStaleChunk); | onStaleChunkLoad(null);
 * @mutate src/lib/chunkReload.ts |   if (isRecoveryReloadInFlight()) return true;\n  return recoverFromChunkError(); |   return recoverFromChunkError();
 * @mutate src/lib/chunkReload.ts |   if (!isChunkLoadError(err)) return false;\n  if (isRecoveryReloadInFlight()) return true; |   if (isRecoveryReloadInFlight()) return true;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, Suspense } from "react";
import { render, waitFor } from "@testing-library/react";
import { resolve, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

const report = vi.fn();
vi.mock("@/lib/errorLogger", () => ({
  report: (...args: unknown[]) => report(...args),
  installGlobalErrorHandlers: vi.fn(),
}));

import {
  __resetChunkReloadForTests,
  cancelPendingChunkRetry,
  CHUNK_RELOAD_MAX_ATTEMPTS,
  isRecoveryReloadInFlight,
  recoverFromChunkError,
} from "@/lib/chunkReload";
import { createLazyModule } from "@/lib/lazyModule";
import { optionalLazy } from "@/lib/optionalLazy";
import { loadModule } from "@/lib/loadModule";

const ROOT = resolve(__dirname, "../..");

type Kind = "hands-off" | "render" | "background";
/** Every loader helper, by the name call sites use, with where it is defined (exact both ways). */
const HELPERS: Record<string, { kind: Kind; file?: string }> = {
  createLazyModule: { kind: "hands-off", file: "src/lib/lazyModule.ts" },
  optionalLazy: { kind: "hands-off", file: "src/lib/optionalLazy.ts" },
  loadModule: { kind: "hands-off", file: "src/lib/loadModule.ts" },
  lazy: { kind: "render" },
  lazyWithPreload: { kind: "render", file: "src/lib/lazyWithPreload.ts" },
  skeletonOnDemand: { kind: "render", file: "src/lib/skeletonOnDemand.tsx" },
  backgroundImport: { kind: "background", file: "src/lib/chunkReload.ts" },
};

/** `name(() => import(` / `name<T>(async () => import(` / `name(() => (x.preload(), import(` in code (comments blanked). */
const LOADER_CALL = /([A-Za-z_$][\w$.]*)\s*(?:<[^<>()]*>)?\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\(?\s*(?:[\w$.]+\(\)\s*,\s*)?import\(/g;

function loaderCallees(): Map<string, string[]> {
  const files = walkSource([resolve(ROOT, "src")]).filter(
    (f) => !/\.test\.tsx?$/.test(f) && !relative(ROOT, f).startsWith("src/test/"),
  );
  const byName = new Map<string, string[]>();
  for (const f of files) {
    const src = readSource(f);
    if (src === null) continue;
    for (const m of blankComments(src).matchAll(LOADER_CALL)) {
      const name = m[1].split(".").pop()!; // React.lazy -> lazy
      const list = byName.get(name) ?? [];
      list.push(relative(ROOT, f));
      byName.set(name, list);
    }
  }
  return byName;
}

describe("every on-demand import helper is classified (inventory from source)", () => {
  const callees = loaderCallees();

  it("the inventory is real (floor)", () => {
    const sites = [...callees.values()].reduce((n, l) => n + l.length, 0);
    expect(sites).toBeGreaterThan(300); // 340 on 2026-11-09
    expect(callees.size).toBeGreaterThan(5);
  });

  it("the classified helpers are exactly the ones call sites use", () => {
    expect([...callees.keys()].sort()).toEqual(Object.keys(HELPERS).sort());
  });

  it("each hands-off helper's own definition hands a failed import to the shared recovery", () => {
    for (const [name, { kind, file }] of Object.entries(HELPERS)) {
      if (kind !== "hands-off") continue;
      const code = blankComments(readSource(resolve(ROOT, file!)) ?? "");
      const handsOff = name === "loadModule" ? /staleChunkHandoff\?\.\(err\)/.test(code) : /handOffStaleChunk\(err\)/.test(code);
      expect(handsOff, `${name} (${file})`).toBe(true);
    }
    // loadModule's hand-off is the one chunkReload.ts registers (loadModule.ts cannot import chunkReload.ts).
    expect(blankComments(readSource(resolve(ROOT, "src/lib/chunkReload.ts")) ?? "")).toMatch(/onStaleChunkLoad\(handOffStaleChunk\)/);
  });

  it("each render helper really is React.lazy underneath (its failure reaches a boundary)", () => {
    for (const [name, { kind, file }] of Object.entries(HELPERS)) {
      if (kind !== "render" || !file) continue;
      expect(blankComments(readSource(resolve(ROOT, file)) ?? ""), `${name} (${file})`).toMatch(/\blazy\(/);
    }
  });
});

// ─── behaviour, on the real chunkReload.ts ────────────────────────────────────

const STALE = () => new TypeError("Failed to fetch dynamically imported module: https://x/assets/dockSheets-D9MaR0It.js");
const BUG = () => new TypeError("Cannot read properties of undefined (reading 'title')");
const attempts = () => Number(sessionStorage.getItem("helpr_chunk_reload_count") ?? "0");
const spendAllAttempts = () => {
  sessionStorage.setItem("helpr_chunk_reload_count", String(CHUNK_RELOAD_MAX_ATTEMPTS));
  sessionStorage.setItem("helpr_chunk_reload_at", String(Date.now()));
};

const originalLocation = window.location;
beforeEach(() => {
  report.mockReset();
  sessionStorage.clear();
  __resetChunkReloadForTests();
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, href: "http://localhost/jobs", pathname: "/jobs", replace: vi.fn() },
    configurable: true,
    writable: true,
  });
});
afterEach(() => {
  __resetChunkReloadForTests();
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true, writable: true });
});

/** Runs one failed load through each hands-off helper and settles. */
const HANDS_OFF: Record<string, (err: Error) => Promise<void>> = {
  async createLazyModule(err) {
    const m = createLazyModule<{ a: number }>(() => Promise.reject(err), "MobileNav.loadDockSheets");
    m.start();
    await new Promise((r) => setTimeout(r, 0));
  },
  async optionalLazy(err) {
    const Piece = optionalLazy(() => Promise.reject(err), "Test.optionalPiece");
    render(createElement(Suspense, { fallback: null }, createElement(Piece)));
    await new Promise((r) => setTimeout(r, 0));
  },
  async loadModule(err) {
    await loadModule(() => Promise.reject(err)).catch((e: unknown) => report(e));
  },
};

describe.each(Object.keys(HANDS_OFF))("%s on a stale chunk", (name) => {
  const run = HANDS_OFF[name];

  it("starts the shared recovery and reports nothing", async () => {
    await run(STALE());
    await waitFor(() => expect(isRecoveryReloadInFlight()).toBe(true));
    expect(attempts()).toBe(1);
    expect(report).not.toHaveBeenCalled();
  });

  it("is quiet, and spends no attempt, while a recovery reload is already in flight", async () => {
    expect(recoverFromChunkError()).toBe(true); // attempt 1 is under way
    expect(attempts()).toBe(1);
    await run(STALE());
    expect(attempts()).toBe(1);
    expect(report).not.toHaveBeenCalled();
    // No second reload queued behind the one under way (it would fire 5 s later on a page that is still loading).
    expect(cancelPendingChunkRetry()).toBe(false);
  });

  it("IS reported, with the reason, once recovery declines (attempts spent)", async () => {
    spendAllAttempts();
    await run(STALE());
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    if (name !== "loadModule") {
      // loadModule rejects to its caller, which reports in its own words.
      expect(report.mock.calls[0][1]).toMatchObject({ context: { chunkRecovery: { reason: "attempts_spent" } } });
    }
  });

  it("still reports a failure that is not a stale chunk, and starts no reload", async () => {
    await run(BUG());
    await waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(isRecoveryReloadInFlight()).toBe(false);
    expect(attempts()).toBe(0);
  });
});
