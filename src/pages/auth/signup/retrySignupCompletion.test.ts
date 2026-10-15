/**
 * Q1810 (Sentry JAVASCRIPT-3R, 2026-10-13): complete-signup's request never
 * reached Supabase (no function log for it), and the signup form gave up after
 * that ONE unsent request. These pin the second send and that the signup form
 * uses it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { invokeWithOneRetryIfUnsent, isUnsentRequest, waitForAWorkingPage } from "./retrySignupCompletion";

const unsent = () => Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError" });
const answered = () => Object.assign(new Error("Edge Function returned a non-2xx status code"), { name: "FunctionsHttpError" });

describe("invokeWithOneRetryIfUnsent", () => {
  it("sends again once when the first request never got an answer", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ data: null, error: unsent() })
      .mockResolvedValueOnce({ data: { success: true }, error: null });
    const wait = vi.fn().mockResolvedValue(undefined);
    const out = await invokeWithOneRetryIfUnsent(send, wait);
    expect(send).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ data: { success: true }, error: null });
  });

  it("sends only twice, then hands back the second failure", async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: unsent() });
    const out = await invokeWithOneRetryIfUnsent(send, async () => {});
    expect(send).toHaveBeenCalledTimes(2);
    expect(isUnsentRequest(out.error)).toBe(true);
  });

  it("never resends an answer the function gave", async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: answered() });
    await invokeWithOneRetryIfUnsent(send, async () => {});
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never sends again once the caller has given up (its 60 s wait ran out)", async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: unsent() });
    const gaveUp = new AbortController();
    const out = await invokeWithOneRetryIfUnsent(send, async () => { gaveUp.abort(); }, gaveUp.signal);
    expect(send).toHaveBeenCalledTimes(1);
    expect(isUnsentRequest(out.error)).toBe(true);
  });

  it("never resends a success", async () => {
    const send = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
    await invokeWithOneRetryIfUnsent(send, async () => {});
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("waitForAWorkingPage", () => {
  it("waits for a hidden page to come back before the second send", async () => {
    vi.useFakeTimers();
    try {
      let state: DocumentVisibilityState = "hidden";
      const target = new EventTarget();
      Object.defineProperty(target, "visibilityState", { get: () => state });
      const doc = target as unknown as Document;
      let done = false;
      void waitForAWorkingPage(1000, doc).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(5000);
      expect(done).toBe(false);
      state = "visible";
      target.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting on a page that stays hidden past the cap", async () => {
    vi.useFakeTimers();
    try {
      const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" }) as unknown as Document;
      let done = false;
      void waitForAWorkingPage(1000, doc, 20_000).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(20_999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes after the minimum wait on a visible page", async () => {
    vi.useFakeTimers();
    try {
      const doc = Object.assign(new EventTarget(), { visibilityState: "visible" }) as unknown as Document;
      let done = false;
      void waitForAWorkingPage(1000, doc).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Every complete-signup call in the app goes through the second send.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("complete-signup call sites (Q1810)", () => {
  const sites = sourceFiles(join(process.cwd(), "src")).flatMap((file) => {
    const code = blankComments(readFileSync(file, "utf8"));
    const found: { file: string; wrapped: boolean; lastArg: string }[] = [];
    const re = /functions\.invoke\(\s*["']complete-signup["']/g;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      const before = code.slice(Math.max(0, m.index - 80), m.index);
      const wrapper = before.lastIndexOf("invokeWithOneRetryIfUnsent(");
      const wrapped = /invokeWithOneRetryIfUnsent\(\s*\(\)\s*=>\s*supabase\.$/.test(before);
      // The wrapper call's last argument: the signal that stops a late second send.
      let lastArg = "";
      if (wrapped) {
        const open = m.index - before.length + wrapper + "invokeWithOneRetryIfUnsent(".length;
        let depth = 0;
        let lastComma = open;
        for (let i = open; i < code.length; i++) {
          const c = code[i];
          if (c === "(" || c === "{" || c === "[") depth++;
          else if (c === ")" || c === "}" || c === "]") {
            if (depth === 0) { lastArg = code.slice(lastComma, i).trim(); break; }
            depth--;
          } else if (c === "," && depth === 0) lastComma = i + 1;
        }
      }
      found.push({ file, wrapped, lastArg });
    }
    return found;
  });

  it("finds the signup form's call", () => {
    expect(sites.length).toBeGreaterThan(0);
  });

  it("sends each one through invokeWithOneRetryIfUnsent", () => {
    expect(sites.filter((s) => !s.wrapped)).toEqual([]);
  });

  it("passes each one the signal its own timeout aborts", () => {
    const missing = sites.filter((s) => !/^[A-Za-z_$][\w$.]*$/.test(s.lastArg) || /=>/.test(s.lastArg));
    expect(missing.map((s) => `${s.file}: last argument ${JSON.stringify(s.lastArg)}`)).toEqual([]);
    const signup = readFileSync(join(process.cwd(), "src/pages/auth/Signup.tsx"), "utf8");
    expect(blankComments(signup)).toMatch(/withTimeout\(completeProfile\(userId, gaveUp\.signal\)[^;]*\.finally\(\(\) => gaveUp\.abort\(\)\)/);
  });
});

// @mutate src/pages/auth/signup/retrySignupCompletion.ts |   if (!isUnsentRequest(first.error)) return first; |   return first;
// @mutate src/pages/auth/signup/retrySignupCompletion.ts | === "FunctionsFetchError" | !== undefined
// @mutate src/pages/auth/signup/retrySignupCompletion.ts |       if (!doc \|\| doc.visibilityState !== "hidden") return resolve(); |       return resolve();
// @mutate src/pages/auth/signup/retrySignupCompletion.ts |   await wait(); |
// @mutate src/pages/auth/Signup.tsx | await invokeWithOneRetryIfUnsent(() => supabase.functions.invoke("complete-signup", { | await supabase.functions.invoke("complete-signup", ({
// @mutate src/pages/auth/signup/retrySignupCompletion.ts |   if (signal?.aborted) return first; |
// @mutate src/pages/auth/signup/retrySignupCompletion.ts |       cap = setTimeout(finish, maxHiddenMs); |
// @mutate src/pages/auth/Signup.tsx |     }), undefined, gaveUp); |     }));
// @mutate src/pages/auth/Signup.tsx | .finally(() => gaveUp.abort()); | ;
