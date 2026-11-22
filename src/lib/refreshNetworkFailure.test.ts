// Q1158: what counts as "the session refresh failed on the network" (src/lib/refreshNetworkFailure.ts). A thrown
// refresh or a 5xx marks it; any token answer under 500 (a refusal, a refreshed session, a password sign-in) clears it,
// so the profile gate never shows the offline card off a stale failure (lh-silent-failure re-review 2026-11-22).
// @mutate src/lib/refreshNetworkFailure.ts | else if (res.status < 500) failedAt = null; | else void 0;
// @mutate src/lib/refreshNetworkFailure.ts | if (refresh && res.status >= 500) markFailed(); | if (false) markFailed();
import { afterEach, describe, expect, it, vi } from "vitest";

const REFRESH = "https://proj.supabase.co/auth/v1/token?grant_type=refresh_token";
const PASSWORD = "https://proj.supabase.co/auth/v1/token?grant_type=password";
const REST = "https://proj.supabase.co/rest/v1/jobs?select=id";

async function load(answer: (url: string) => Response | "throw") {
  vi.resetModules();
  const mod = await import("./refreshNetworkFailure");
  const f = mod.noteRefreshOutcome(async (input) => {
    const a = answer(String(input));
    if (a === "throw") throw new TypeError("Failed to fetch");
    return a;
  });
  return { mod, f };
}

afterEach(() => vi.useRealTimers());

describe("refreshNetworkFailure", () => {
  it("a thrown refresh marks it and tells listeners; a later password sign-in clears it", async () => {
    let next: Response | "throw" = "throw";
    const { mod, f } = await load(() => next);
    const told = vi.fn();
    mod.onRefreshNetworkFailure(told);
    await expect(f(REFRESH)).rejects.toThrow("Failed to fetch");
    expect(mod.refreshFailedRecently()).toBe(true);
    expect(told).toHaveBeenCalledTimes(1);
    next = new Response("{}", { status: 200 });
    await f(PASSWORD);
    expect(mod.refreshFailedRecently()).toBe(false);
  });

  it("a 5xx refresh marks it; a 4xx refusal is not a network failure (and clears one)", async () => {
    let status = 503;
    const { mod, f } = await load(() => new Response("{}", { status }));
    await f(REFRESH);
    expect(mod.refreshFailedRecently()).toBe(true);
    status = 400;
    await f(REFRESH);
    expect(mod.refreshFailedRecently()).toBe(false);
  });

  it("other requests pass untouched and never mark it; a failure older than 30 s no longer counts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { mod, f } = await load((url) => (url === REST ? "throw" : "throw"));
    await expect(f(REST)).rejects.toThrow();
    expect(mod.refreshFailedRecently()).toBe(false);
    await expect(f(REFRESH)).rejects.toThrow();
    expect(mod.refreshFailedRecently()).toBe(true);
    vi.setSystemTime(Date.now() + mod.REFRESH_FAILURE_FRESH_MS + 1);
    expect(mod.refreshFailedRecently()).toBe(false);
  });
});
