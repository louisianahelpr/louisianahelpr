/**
 * Q1158/Q654 (B48, 11-03): the refusal words load only when they can be needed.
 *
 * src/lib/lifecycleErrors.ts is on every signed-in first screen (88 importers).
 * Its ~120 KB of copy moved to src/lib/lifecycleErrorCopy.ts, fetched on the
 * first input, after a timer, or the first time a sentence is asked for. This
 * holds the four things that make that safe:
 *   1. once loaded, every code of every RPC reads exactly its table's sentence
 *      through the public helpers (no key lost, no text changed in the move);
 *   2. nothing reaches the copy statically from member code, so it stays off boot;
 *   3. before it loads, a helper answers null (the caller's own plain sentence),
 *      never a raw code, and sends for the words; rpcErrorCode waits for them;
 *   4. no caller falls back to the error's own message (a raw code).
 */
// @mutate src/lib/lifecycleErrors.ts | return code ? codes[code] : null; | return code ? codes[code].trimEnd() + " " : null;
// @mutate src/lib/lifecycleErrors.ts | const lifecycleErrorCopy = () => loadModule(() => import("./lifecycleErrorCopy")); | import * as StaticCopy from "./lifecycleErrorCopy";\nconst lifecycleErrorCopy = () => Promise.resolve(StaticCopy);
// @mutate src/lib/lifecycleErrors.ts | if (!table) return null; // the words are on their way | if (!table) return rawMessage(error) \|\| null; // the words are on their way
// @mutate src/lib/lifecycleErrors.ts | const m = await loadLifecycleErrorCopy();\n  return m ? codeNamedIn | const m = loadedCopy();\n  return m ? codeNamedIn
// @mutate src/lib/lifecycleErrors.ts |     void loadLifecycleErrorCopy();\n    return null; // the words are on their way |     return null; // the words are on their way
// @mutate src/components/series/EndSeriesControl.tsx | rpcErrorMessage("end_recurring_series", error) ?? "Couldn't | rpcErrorMessage("end_recurring_series", error) ?? error.message ?? "Couldn't
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { trackedFiles } from "@/test/helpers/trackedFiles";
import { LIFECYCLE_REASONS, RPC_ERROR_COPY } from "@/lib/lifecycleErrorCopy";
import { lifecycleErrorMessage, rpcErrorCode, rpcErrorMessage, type MappedRpc } from "@/lib/lifecycleErrors";

const ROOT = join(__dirname, "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
type G = { __lhLifecycleErrorCopy?: unknown };

describe("lifecycleErrors: every sentence survives the move to its own chunk", () => {
  it("each RPC code reads its table's own sentence through rpcErrorMessage", () => {
    let n = 0;
    for (const [rpc, codes] of Object.entries(RPC_ERROR_COPY)) {
      for (const [code, text] of Object.entries(codes as Record<string, string>)) {
        // Postgres wraps the code in its own prose; the whole-token match must still find it.
        expect(rpcErrorMessage(rpc as MappedRpc, { message: `P0001: ${code}` }), `${rpc}.${code}`).toBe(text);
        n++;
      }
    }
    expect(n).toBeGreaterThan(1600);
  });

  it("each lifecycle code reads the first sentence whose code it contains, as before the move", () => {
    const entries = Object.entries(LIFECYCLE_REASONS);
    for (const [code] of entries) {
      const expected = entries.find(([c]) => code.includes(c))![1];
      expect(lifecycleErrorMessage({ message: `ERROR: ${code}` }), code).toBe(expected);
    }
    expect(entries.length).toBeGreaterThan(25);
  });
});

describe("lifecycleErrors: the copy stays off the boot path", () => {
  it("lifecycleErrors.ts reaches the copy only through import() and `import type`", () => {
    const src = blankComments(read("src/lib/lifecycleErrors.ts"));
    expect(src).toMatch(/import\("\.\/lifecycleErrorCopy"\)/);
    const staticRefs = [...src.matchAll(/^\s*(import|export)\b[^;]*?from\s+["'][^"']*lifecycleErrorCopy["']/gm)].map((m) => m[0]);
    expect(staticRefs.every((s) => /^\s*import type\b/.test(s)), staticRefs.join("\n")).toBe(true);
  });

  it("no member module imports the copy statically (only the admin console's lazy table and tests)", () => {
    // @two-way src/lib/lifecycleErrors.lazyCopy.test.ts:stale static-import allowlist entry
    const ALLOWED = new Set(["src/components/admin/adminRpcErrorCopy.ts", "src/test/setup.ts"]);
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/fixtures/"));
    expect(files.length).toBeGreaterThan(1000);
    const importsCopy = (src: string) =>
      /^\s*(import|export)\s+(?!type\b)[^;]*?from\s+["'][^"']*lifecycleErrorCopy["']/m.test(src) ||
      /^\s*\(?[^\n]*=\s*await import\(["'][^"']*lifecycleErrorCopy["']\)/m.test(src);
    const offenders = files.filter((f) => !ALLOWED.has(f) && importsCopy(blankComments(read(f))));
    expect(offenders).toEqual([]);
    for (const f of ALLOWED) {
      if (!importsCopy(blankComments(read(f)))) throw new Error(`stale static-import allowlist entry ${f} — remove it`);
    }
  });
});

describe("lifecycleErrors: before the words arrive", () => {
  afterEach(() => {
    vi.resetModules();
  });

  async function freshUnloaded() {
    vi.resetModules();
    const g = globalThis as G;
    const saved = g.__lhLifecycleErrorCopy;
    delete g.__lhLifecycleErrorCopy;
    const mod = await import("@/lib/lifecycleErrors");
    return { mod, restore: () => void (g.__lhLifecycleErrorCopy = saved) };
  }

  it("rpcErrorMessage answers null (never the raw code), then the sentence once the words load", async () => {
    const { mod, restore } = await freshUnloaded();
    try {
      const err = { message: "job_not_open" };
      expect(mod.rpcErrorMessage("accept_application", err)).toBeNull();
      await vi.waitFor(() => expect(mod.rpcErrorMessage("accept_application", err)).toBe(RPC_ERROR_COPY.accept_application.job_not_open));
    } finally {
      restore();
    }
  });

  it("lifecycleErrorMessage answers null at first and sends for the words itself", async () => {
    const { mod, restore } = await freshUnloaded();
    try {
      const err = { message: "ERROR: job_not_started" };
      expect(mod.lifecycleErrorMessage(err)).toBeNull();
      await vi.waitFor(() => expect(mod.lifecycleErrorMessage(err)).toBe(LIFECYCLE_REASONS.job_not_started));
    } finally {
      restore();
    }
  });

  it("rpcErrorCode waits for the words, so a caller's branch is decided on the real code", async () => {
    const { mod, restore } = await freshUnloaded();
    try {
      await expect(mod.rpcErrorCode("poster_cancel_job", { message: "quote_changed" })).resolves.toBe("quote_changed");
    } finally {
      restore();
    }
  });

  it("the loaded helpers agree (sanity: this file's module reads the setup's words)", async () => {
    await expect(rpcErrorCode("poster_cancel_job", { message: "x quote_changed y" })).resolves.toBe("quote_changed");
  });
});

describe("lifecycleErrors: no caller shows the raw code", () => {
  it("no rpcErrorMessage/lifecycleErrorMessage falls back to the error's own message", () => {
    // SmsPhonePrompt writes the words onto the error for the error log only (no prompt is shown on a failure).
    // @two-way src/lib/lifecycleErrors.lazyCopy.test.ts:stale raw-message allowlist entry
    const ALLOWED = new Set(["src/components/notificationPreferences/SmsPhonePrompt.tsx"]);
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));
    let callers = 0;
    const offenders: string[] = [];
    for (const f of files) {
      const src = blankComments(read(f));
      if (!/\b(rpcErrorMessage|lifecycleErrorMessage)\(/.test(src)) continue;
      callers++;
      const re = /\b(?:rpcErrorMessage|lifecycleErrorMessage)\((?:[^()]|\([^()]*\))*\)\s*\?\?\s*[\w$.?]*\.message\b/g;
      const hits = [...src.matchAll(re)].map((m) => `${f}: ${m[0]}`);
      if (ALLOWED.has(f)) {
        if (hits.length === 0) throw new Error(`stale raw-message allowlist entry ${f} — remove it`);
        continue;
      }
      offenders.push(...hits);
    }
    expect(callers).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});
