/**
 * lh-silent-failure review of 46b7b91713 (Q1816): the ID-check sheet loads through optionalLazy beside the routes, so a
 * failed chunk draws nothing. openIdentityCheck() still answered true, and every press that opens the sheet went dead
 * until a reload. Now:
 *   1. optionalLazy starts the boundaries' stale-chunk reload for a chunk error, reports once (never a second report for
 *      untilReload's ModuleUnavailableError, which errorLogger already reported), and runs its onFail hook;
 *   2. the sheet's mounts call markIdentitySheetUnavailable: a press waiting on the sheet is told, and openIdentityCheck
 *      answers false from then on;
 *   3. every button whose only job is to open the sheet uses openIdentityCheckOrSay (a toast, never a dead press), and
 *      every other caller either branches on the answer or throws its own refusal message right after (exact list).
 *
 * @mutate src/lib/optionalLazy.ts |       if (!unavailable && isChunkLoadError(err)) recoverFromChunkError(); |
 * @mutate src/lib/optionalLazy.ts |       if (!unavailable) report(err, | if (true) report(err,
 * @mutate src/lib/identityCheck.ts |   if (sheetUnavailable \|\| appSaysUnavailable()) return false;\n |
 * @mutate src/lib/identityCheck.ts |   if (sheetUnavailable \|\| appSaysUnavailable()) return false; |   if (sheetUnavailable) return false;
 * @mutate src/lib/identityCheck.ts |   if (waiting \|\| opts.entryLink) toast.error(IDENTITY_SHEET_UNAVAILABLE); |   if (opts.entryLink) toast.error(IDENTITY_SHEET_UNAVAILABLE);
 * @mutate src/lib/identityCheck.ts |   if (waiting \|\| opts.entryLink) toast.error(IDENTITY_SHEET_UNAVAILABLE); |   if (waiting) toast.error(IDENTITY_SHEET_UNAVAILABLE);
 * @mutate src/components/identity/IdentityCheckMount.tsx | "IdentityCheckHost", () => markIdentitySheetUnavailable({ | "IdentityCheckHost", () => void ({
 * @mutate src/components/profile/SettingsTab.tsx | onClick={() => openIdentityCheckOrSay("general")} /> | onClick={() => void openIdentityCheck("general")} />
 */
import React, { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, waitFor } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const h = vi.hoisted(() => ({ reported: [] as Array<{ err: unknown; opts: unknown }>, recover: 0, toasts: [] as string[], on: true }));
vi.mock("@/lib/errorLogger", () => ({ report: (err: unknown, opts: unknown) => h.reported.push({ err, opts }), logError: () => {} }));
vi.mock("@/lib/chunkReload", () => ({
  isChunkLoadError: (e: unknown) => /Importing a module script failed|dynamically imported/.test(String((e as Error)?.message ?? e)),
  recoverFromChunkError: () => { h.recover++; return false; },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (m: string) => h.toasts.push(m), success: vi.fn() }) }));
vi.mock("@/lib/identityCheckSwitch", () => ({ identityCheckOn: () => h.on }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { optionalLazy } from "@/lib/optionalLazy";
import { ModuleUnavailableError } from "@/lib/loadModule";
import {
  IDENTITY_SHEET_UNAVAILABLE,
  IDENTITY_SHEET_UNAVAILABLE_EVENT,
  __resetIdentitySheetUnavailable,
  closeIdentityCheck,
  markIdentitySheetUnavailable,
  openIdentityCheck,
  openIdentityCheckOrSay,
} from "@/lib/identityCheck";

beforeEach(() => { h.reported.length = 0; h.recover = 0; h.toasts.length = 0; h.on = true; __resetIdentitySheetUnavailable(); closeIdentityCheck(); });
afterEach(() => { __resetIdentitySheetUnavailable(); });

const drawn = (C: React.ComponentType) => render(<Suspense fallback={null}><C /></Suspense>);

describe("optionalLazy: a failed chunk recovers, reports once, and tells", () => {
  it("a stale chunk starts the recovery reload, is reported as a warning and runs onFail", async () => {
    const onFail = vi.fn();
    const C = optionalLazy(() => Promise.reject(new TypeError("Importing a module script failed.")), "Probe", onFail);
    drawn(C);
    await waitFor(() => expect(onFail).toHaveBeenCalledTimes(1));
    expect(h.recover).toBe(1);
    expect(h.reported).toHaveLength(1);
    expect(h.reported[0].opts).toMatchObject({ severity: "warning", tags: { source: "Probe" } });
  });

  it("untilReload's ModuleUnavailableError is not reported again, and starts no second reload", async () => {
    const onFail = vi.fn();
    const C = optionalLazy(() => Promise.reject(new ModuleUnavailableError("no recovery reload is under way")), "Probe", onFail);
    drawn(C);
    await waitFor(() => expect(onFail).toHaveBeenCalledTimes(1));
    expect(h.reported).toHaveLength(0);
    expect(h.recover).toBe(0);
  });
});

describe("the ID-check sheet that cannot load is said, never a dead press", () => {
  it("before: opens; after markIdentitySheetUnavailable: answers false", () => {
    expect(openIdentityCheck("post")).toBe(true);
    closeIdentityCheck();
    markIdentitySheetUnavailable();
    expect(openIdentityCheck("post")).toBe(false);
  });

  it("a press already waiting on the sheet hears it, once", () => {
    expect(openIdentityCheck("accept")).toBe(true);
    markIdentitySheetUnavailable();
    expect(h.toasts).toEqual([IDENTITY_SHEET_UNAVAILABLE]);
  });

  it("a visit through an entry link (?verify_id=1) whose sheet failed hears it too, once; a quiet failure stays quiet", () => {
    markIdentitySheetUnavailable({ entryLink: true });
    expect(h.toasts).toEqual([IDENTITY_SHEET_UNAVAILABLE]);
    __resetIdentitySheetUnavailable();
    h.toasts.length = 0;
    markIdentitySheetUnavailable();
    expect(h.toasts).toEqual([]);
  });

  it("openIdentityCheckOrSay toasts when the sheet cannot open, and stays silent with the check switched off", () => {
    markIdentitySheetUnavailable();
    openIdentityCheckOrSay("general");
    expect(h.toasts).toEqual([IDENTITY_SHEET_UNAVAILABLE]);
    h.toasts.length = 0;
    h.on = false;
    openIdentityCheckOrSay("general");
    expect(h.toasts).toEqual([]);
  });

  it("the sheet's mounts tell identityCheck when they fail (IdentityCheckHost and App's IdentityCheckMount)", () => {
    const mount = blankComments(readFileSync(resolve(__dirname, "../components/identity/IdentityCheckMount.tsx"), "utf8"));
    expect(mount).toContain('"IdentityCheckHost", () => markIdentitySheetUnavailable({ entryLink: hasIdentityEntryParam(new URLSearchParams(window.location.search)) }));');
    const app = blankComments(readFileSync(resolve(__dirname, "../App.tsx"), "utf8"));
    const decl = app.slice(app.indexOf("const IdentityCheckMount = optionalLazy("), app.indexOf("\n", app.indexOf("const IdentityCheckMount = optionalLazy(")));
    expect(decl).toContain("__lhIdentitySheetUnavailable = true;");
    expect(decl).toContain(`window.dispatchEvent(new Event("${IDENTITY_SHEET_UNAVAILABLE_EVENT}"))`);
  });

  it("App's mount failure (the window flag and event) makes openIdentityCheck answer false and tells a waiting press", () => {
    expect(openIdentityCheck("post")).toBe(true);
    (window as Window & { __lhIdentitySheetUnavailable?: boolean }).__lhIdentitySheetUnavailable = true;
    window.dispatchEvent(new Event(IDENTITY_SHEET_UNAVAILABLE_EVENT));
    expect(h.toasts).toEqual([IDENTITY_SHEET_UNAVAILABLE]);
    __resetIdentitySheetUnavailable();
    (window as Window & { __lhIdentitySheetUnavailable?: boolean }).__lhIdentitySheetUnavailable = true;
    expect(openIdentityCheck("post")).toBe(false);
  });

  it("every caller of openIdentityCheck branches on its answer or throws its own refusal right after (exact list)", () => {
    const root = resolve(__dirname, "../..");
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|\/test\//.test(f));
    // Bare calls (the answer unused) allowed only where the caller's own error message follows at once, inside the
    // sheet itself, or for the after-confirm offer (no press waits on it). Exact both ways.
    const BARE_OK: Record<string, string> = {
      "src/lib/crewLifecycle.ts": "throws CrewActionError with the refusal's words right after (x2)",
      "src/lib/quotes/api.ts": "unwrap() throws the refusal's words right after",
      "src/lib/declutter/api.ts": "its callers throw the refusal code right after (errors.ts has the words)",
      "src/lib/helprTasks/api.ts": "returns rpcErrorMessage for the refusal right after",
      "src/components/identity/IdentityCheckSheet.tsx": "the sheet itself: it is loaded",
      "src/lib/identityCheck.ts": "offerIdentityCheckAfterConfirm: an offer after sign-up confirm, no press waits on it",
    };
    const bare: string[] = [];
    for (const f of files) {
      const src = blankComments(readFileSync(resolve(root, f), "utf8"));
      for (const line of src.split("\n")) {
        if (!/\bopenIdentityCheck\(/.test(line) || /function openIdentityCheck\(/.test(line)) continue;
        const used = /(&&|\|\||return|=|\?)\s*openIdentityCheck\(/.test(line) || /if \(openIdentityCheck\(/.test(line) || /\(openIdentityCheck\([^)]*\) \|\|/.test(line);
        if (!used) bare.push(f);
      }
    }
    const got = [...new Set(bare)].sort();
    expect(got.length).toBeGreaterThan(3);
    expect(got).toEqual(Object.keys(BARE_OK).sort());
  });
});
