/**
 * Owner 2026-11-14, Sentry weekly report (Nov 6-13): "Fix them all now". Measured on prod error_logs (read-only SQL,
 * the 8 days to 2026-11-14), each case below is one row class, pinned here with its fix:
 *
 *  1. "Rejected" (29 rows) and "Failed to register a ServiceWorker" (6), unhandled rejections from
 *     /registerSW.js:1:98: vite-plugin-pwa's injected script called navigator.serviceWorker.register() with no catch.
 *     src/main.tsx already registers /sw.js itself and catches; the plugin no longer injects its script.
 *  2. "shop_not_found — code=PT404" (16) from the query cache on a deleted shop's page: PT404 is the not-found
 *     answer an RPC raises on purpose and the page shows its own "isn't available" screen. Not reported.
 *  3. "Failed to fetch dynamically imported module: .../FreshDeclutterStrip-*.js" (2), an unhandled rejection: a
 *     warm-up `void import()` with no catch, after a deploy removed the old hash. Every warm-up import catches.
 *  4. "background import failed: sentry / posthog / boot-* / signout-watch" (~35): a background chunk is asked a
 *     second time before its failure is counted.
 *
 * @mutate vite.config.ts |       injectRegister: false, |       injectRegister: "script-defer",
 * @mutate src/lib/queryClient.ts |   if ((error as { code?: unknown } \| null)?.code === "PT404") return; |
 * @mutate src/components/landing/FreshDeclutterSection.tsx |       import("./FreshDeclutterStrip").catch(() => { |       void import("./FreshDeclutterStrip"); (() => {
 * @mutate src/lib/chunkReload.ts |     return await load();\n  } catch (first) { |     return await load();\n  } catch (first) { throw first;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

const reportSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/errorLogger", () => ({ report: reportSpy }));

import { reportCacheError } from "@/lib/queryClient";
import { __resetChunkReloadForTests, backgroundImport, getBackgroundImportFailures } from "@/lib/chunkReload";

const ROOT = resolve(import.meta.dirname, "../..");
const code = (p: string) => blankComments(readSource(resolve(ROOT, p)) ?? "");

describe("1. the service worker registration catches its own refusal", () => {
  it("vite-plugin-pwa injects no registerSW.js (its register() had no catch)", () => {
    const vite = code("vite.config.ts");
    expect(vite).toContain("VitePWA({");
    expect(vite).toMatch(/injectRegister:\s*false\b/);
  });

  it("main.tsx registers /sw.js itself and catches the refusal", () => {
    expect(code("src/main.tsx")).toMatch(/\.register\("\/sw\.js",\s*\{\s*scope:\s*"\/"\s*\}\)\s*\.catch\(/);
  });
});

describe("2. a deliberate not-found answer (PT404) is not reported", () => {
  beforeEach(() => reportSpy.mockClear());

  it("shop_not_found PT404 from a read is not reported", () => {
    reportCacheError("QueryCache", Object.assign(new Error("shop_not_found"), { code: "PT404", status: 404 }), ["shops", "page", "x"]);
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it("another refusal still reports (the floor)", () => {
    reportCacheError("QueryCache", Object.assign(new Error("permission denied for table shops"), { code: "42501" }), ["shops", "page", "x"]);
    expect(reportSpy).toHaveBeenCalledTimes(1);
  });
});

describe("3. no fire-and-forget import() is left uncaught", () => {
  // entry.ts's `void import("./main")` is left unhandled on purpose: the index.html boot watchdog owns that failure.
  // @two-way src/test/prodErrorsQuiet1114.test.ts:stale ALLOWED entry
  const ALLOWED = new Set(["src/entry.ts"]);
  const files = walkSource([resolve(ROOT, "src")]).filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("/src/test/"));

  it("the walk sees the source tree (inventory floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it("every ALLOWED file still has its uncaught import (exact both ways)", () => {
    const stale = [...ALLOWED].filter((rel) => !/\bvoid\s+import\(/.test(blankComments(readSource(resolve(ROOT, rel)) ?? "")));
    expect(stale, "stale ALLOWED entry — remove it").toEqual([]);
  });

  it("every `void import(...)` statement is in the allow-list", () => {
    const offenders = files
      .map((f) => relative(ROOT, f))
      .filter((rel) => !ALLOWED.has(rel) && /\bvoid\s+import\(\s*["'][^"']+["']\s*\)\s*;/.test(blankComments(readSource(resolve(ROOT, rel)) ?? "")));
    expect(offenders).toEqual([]);
  });
});

describe("4. a background chunk is asked twice before its failure counts", () => {
  beforeEach(() => __resetChunkReloadForTests());

  it("a load that fails once and then loads is not counted as failed", async () => {
    let calls = 0;
    const load = () => (++calls === 1 ? Promise.reject(new Error("Failed to fetch dynamically imported module: /assets/posthog-x.js")) : Promise.resolve(7));
    await expect(backgroundImport(load, "posthog")).resolves.toBe(7);
    expect(calls).toBe(2);
    expect(getBackgroundImportFailures()).toEqual({});
  });

  it("a load that fails twice IS counted, once (the floor)", async () => {
    const load = () => Promise.reject(new Error("Failed to fetch dynamically imported module: /assets/posthog-x.js"));
    await expect(backgroundImport(load, "posthog")).rejects.toThrow(/posthog-x/);
    expect(getBackgroundImportFailures()).toEqual({ posthog: 1 });
  });
});
