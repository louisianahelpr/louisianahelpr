// THE EXPIRED-SESSION RESTORE AGAINST THE REAL AUTH CLIENT (Q1158, lead guardrails 2026-11-22).
//
// useAuthReady is ready at once with a returning member's stored user while
// auth-js refreshes their expired token (useAuthReady.expiredRestore.test.tsx).
// This drives the REAL supabase-js client (auth-js 2.119 refresh, backoff and
// sign-out logic; only the network is stubbed) through the three things that
// restore must never change:
//   1. A DEFINITIVE refusal (refresh token not found / already used, session or
//      user gone, user banned) signs out the moment the answer comes back, never
//      after a grace period; only a refresh that fails on the network (or a 5xx)
//      keeps the stored user.
//   2. Nothing private from the device cache shows for a refused member: the
//      persisted query cache waits for whenSessionConfirmed(), which is false
//      for a refusal and pending while the refresh has not been accepted.
//   3. A first-screen query fired while the refresh is in flight waits for it
//      and goes out with the NEW token: nothing is sent with the expired token
//      (PostgREST's 401 "JWT expired") or as anon.
// @mutate src/hooks/useAuthReady.ts | else if (event === "SIGNED_OUT") settleRestore(false); | else if (event === "SIGNED_OUT") void 0;
// @mutate src/hooks/useAuthReady.ts | if (session) settleRestore(true);\n          else | if (false) settleRestore(true);\n          else
// @mutate src/hooks/useCurrentUser.ts | await client()\n    .then((c) => c.auth.getSession()) | void client()\n    .then((c) => c.auth.getSession())
// @mutate src/components/QueryCacheHydrator.tsx | if (!(await whenSessionConfirmed()) \|\| cancelled) return; | if (cancelled) return;

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const h = vi.hoisted(() => ({ client: null as unknown, persistCalls: 0, profileRow: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return h.client;
  },
}));
vi.mock("@tanstack/react-query-persist-client", () => ({
  persistQueryClient: () => {
    h.persistCalls += 1;
    return [() => {}, Promise.resolve()];
  },
}));

const BASE = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = `sb-${new URL(BASE).hostname.split(".")[0]}-auth-token`;
const user = { id: "member-1", aud: "authenticated", role: "authenticated", email: "m@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const nowS = () => Math.floor(Date.now() / 1000);
const storedExpired = () => JSON.stringify({ access_token: "old-jwt", refresh_token: "rt-1", token_type: "bearer", expires_in: 3600, expires_at: nowS() - 60, user });

type Sent = { url: string; authorization: string | null };
type TokenAnswer = { status: number; body: unknown } | "network";

/** The network: /auth/v1/token answers `answer` after `delayMs`; every data request is recorded. */
function stubNetwork(answer: TokenAnswer, delayMs: number): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/auth/v1/token")) {
      await new Promise((r) => setTimeout(r, delayMs));
      if (answer === "network") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } });
    }
    const headers = new Headers(init?.headers);
    const authorization = headers.get("Authorization");
    sent.push({ url, authorization });
    if (authorization !== "Bearer new-jwt") {
      return new Response(JSON.stringify({ code: "PGRST301", message: "JWT expired", details: null, hint: null }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const rows = url.includes("/rest/v1/profiles") ? [h.profileRow] : url.includes("/rest/v1/user_roles") ? [] : [{ id: "member-1" }];
    const single = (headers.get("Accept") ?? "").includes("vnd.pgrst.object");
    return new Response(JSON.stringify(single ? rows[0] ?? null : rows), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return sent;
}

function buildClient(): SupabaseClient {
  return createClient(BASE, "sb_publishable_testkey", {
    auth: { storage: window.localStorage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    db: { retry: false } as never,
  });
}

const refused: [string, number, Record<string, unknown>][] = [
  ["refresh token not found", 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }],
  ["refresh token already used", 400, { code: 400, error_code: "refresh_token_already_used", msg: "Invalid Refresh Token: Already Used" }],
  ["session gone (signed out elsewhere)", 403, { code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" }],
  ["user deleted", 403, { code: 403, error_code: "user_not_found", msg: "User from sub claim in JWT does not exist" }],
  ["user banned", 400, { code: 400, error_code: "user_banned", msg: "User is banned" }],
];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  localStorage.clear();
  h.persistCalls = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

async function mount() {
  h.client = buildClient();
  const mod = await import("./useAuthReady");
  const hook = renderHook(() => mod.useAuthReady());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return { ...hook, mod };
}

describe("1. a definitive refusal signs out the moment it comes back", () => {
  // 300 ms: answered inside getSession's 2.5 s race; 4000 ms: after it (only the SIGNED_OUT event can tell).
  const cases = refused.flatMap(([name, status, body]) => [300, 4000].map((ms) => [name, status, body, ms] as const));
  it.each(cases)("%s (%i %j, answered after %i ms): signed out at the answer, not after a grace period", async (_name, status, body, ms) => {
    stubNetwork({ status, body }, ms);
    localStorage.setItem(KEY, storedExpired());
    const { result, mod } = await mount();
    expect(result.current.user?.id).toBe("member-1"); // restored at once
    const confirmed = mod.whenSessionConfirmed();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms - 10);
    });
    expect(result.current.user?.id).toBe("member-1"); // still the member until the answer
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(result.current).toEqual({ isReady: true, user: null });
    expect(localStorage.getItem(KEY)).toBeNull();
    await expect(confirmed).resolves.toBe(false);
  });

  it.each([
    ["the network fails", "network" as TokenAnswer],
    ["the auth server answers 503", { status: 503, body: { msg: "upstream unavailable" } } as TokenAnswer],
  ])("%s: the member keeps the stored user (no Log In bounce) and the session stays stored", async (_name, answer) => {
    stubNetwork(answer, 50);
    localStorage.setItem(KEY, storedExpired());
    const { result, mod } = await mount();
    let settled: boolean | null = null;
    void mod.whenSessionConfirmed().then((v) => { settled = v; });
    // auth-js retries with backoff for up to 30 s before answering.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    expect(result.current).toEqual({ isReady: true, user: expect.objectContaining({ id: "member-1" }) });
    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(settled).toBeNull(); // never confirmed: the device cache stays out
  });
});

describe("2. nothing from the device cache shows before the server accepts the session", () => {
  async function mountHydrator() {
    const { default: QueryCacheHydrator } = await import("@/components/QueryCacheHydrator");
    render(<QueryCacheHydrator />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("a refused refresh never hydrates the persisted cache, even with the hydrator mounted before the hook", async () => {
    stubNetwork({ status: 400, body: { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" } }, 300);
    localStorage.setItem(KEY, storedExpired());
    h.client = buildClient();
    await mountHydrator(); // its effect runs before any useAuthReady bootstrap
    const { result } = await mount();
    expect(result.current.user?.id).toBe("member-1");
    expect(h.persistCalls).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current.user).toBeNull();
    expect(h.persistCalls).toBe(0);
  });

  it.each([300, 4000])("an accepted refresh (answered after %i ms) hydrates it, once, after the answer", async (ms) => {
    stubNetwork({ status: 200, body: { access_token: "new-jwt", refresh_token: "rt-2", token_type: "bearer", expires_in: 3600, expires_at: nowS() + 3600, user } }, ms);
    localStorage.setItem(KEY, storedExpired());
    const { result } = await mount();
    await mountHydrator();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms - 10);
    });
    expect(h.persistCalls).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(result.current.user?.id).toBe("member-1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.persistCalls).toBe(1);
  });

  it("a guest (nothing stored) hydrates at once, as before", async () => {
    stubNetwork("network", 0);
    h.client = buildClient();
    await mountHydrator();
    expect(h.persistCalls).toBe(1);
  });
});

describe("3. a first-screen query fired during the refresh waits for it", () => {
  it("is sent only after the refresh, with the new token: no 401, no anon, no error", async () => {
    const sent = stubNetwork({ status: 200, body: { access_token: "new-jwt", refresh_token: "rt-2", token_type: "bearer", expires_in: 3600, expires_at: nowS() + 3600, user } }, 500);
    localStorage.setItem(KEY, storedExpired());
    const { result } = await mount();
    expect(result.current.user?.id).toBe("member-1");
    // The screen drew at once and asks for its data now, mid-refresh.
    const query = (h.client as SupabaseClient).from("jobs").select("id");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(sent).toEqual([]); // still waiting on the refresh, nothing sent
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const { data, error } = await query;
    expect(error).toBeNull();
    expect(data).toEqual([{ id: "member-1" }]);
    expect(sent.map((s) => s.authorization)).toEqual(["Bearer new-jwt"]);
  });
});

describe("3b. the profile gate (ProtectedRoute's own read) waits for the refresh before its deadline", () => {
  async function mountCurrentUser() {
    h.client = buildClient();
    const { useCurrentUser } = await import("./useCurrentUser");
    // The app's query policy (src/lib/queryClient.ts): one retry 500 ms later, networkMode always.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 500, networkMode: "always" } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const hook = renderHook(() => useCurrentUser(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return hook;
  }
  const accepted = () => ({ status: 200, body: { access_token: "new-jwt", refresh_token: "rt-2", token_type: "bearer", expires_in: 3600, expires_at: nowS() + 3600, user } });

  it("a 13 s refresh (past two 6 s profile deadlines) still ends on the profile, never the couldn't-load card", async () => {
    h.profileRow = { user_id: "member-1", full_name: "Member One", ban_status: null };
    const sent = stubNetwork(accepted(), 13_000);
    localStorage.setItem(KEY, storedExpired());
    const { result } = await mountCurrentUser();
    expect(result.current.user?.id).toBe("member-1"); // the screen drew at once
    let sawError = false;
    for (let t = 0; t < 14_000; t += 500) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      if (result.current.isError) sawError = true;
    }
    expect(sawError).toBe(false);
    expect(result.current.profile).toEqual(expect.objectContaining({ user_id: "member-1" }));
    expect(sent.filter((s) => s.authorization !== "Bearer new-jwt")).toEqual([]);
  });

  it("a banned member's row comes from the server after the refresh (ban_status intact for the /account-banned gate)", async () => {
    h.profileRow = { user_id: "member-1", full_name: "Member One", ban_status: "banned" };
    stubNetwork(accepted(), 300);
    localStorage.setItem(KEY, storedExpired());
    const { result } = await mountCurrentUser();
    expect(result.current.profile).toBeNull(); // nothing from the device first
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current.profile).toEqual(expect.objectContaining({ ban_status: "banned" }));
  });
});
