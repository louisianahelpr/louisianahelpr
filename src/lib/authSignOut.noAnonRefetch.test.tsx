/**
 * A3-L10 (app audit 2026-10-28): after Log out, user_roles and
 * feature_switches_for_me were read again, as anon.
 *
 * Real supabase-js client (localStorage, stubbed network), the real
 * useAuthReady, the real shared queryClient, and the real useFeature /
 * useCurrentUser observers mounted, as on any signed-in screen. Every request
 * the client sends is recorded; after Log out none of the signed-in reads may
 * go out again (they would go out with the anon key: no session is left).
 *
 * Measured on main (2026-10-29, before the fix): the first case was already
 * green here (the observers did not refetch at once: the SIGNED_OUT re-render
 * disables them before anything asks again); the second was red, two
 * user_roles reads with "Bearer pk" after sign-out, from the admin-role
 * lookup's retries (3 tries, 250/500 ms apart) carrying on past Log out.
 *
 * @mutate src/hooks/useCurrentUser.ts |         if (authUserChangedFrom(userId)) throw new SignedOutDuringLookup(); |
 * @mutate src/lib/authUserChanged.ts |   return mirrored.isReady && mirrored.userId !== userId; |   return false;
 * @mutate src/hooks/useAuthReady.ts |   noteAuthUser(snapshot.isReady, snapshot.user?.id ?? null);\n |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BASE = "https://proj.supabase.co";
const STORAGE_KEY = "sb-proj-auth-token";
const userOf = (id: string) => ({ id, aud: "authenticated", role: "authenticated", email: `${id}@example.com`, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" });
const sessionOf = (id: string) => ({ access_token: `at-${id}`, refresh_token: `rt-${id}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: userOf(id) });

const holder: { client: SupabaseClient | null } = { client: null };
vi.mock("@/integrations/supabase/client", () => ({
  get supabase() { return holder.client; },
}));
vi.mock("@/integrations/supabase/keychainStorageAdapter", () => ({ clearNativeSessionMirror: vi.fn(async () => {}) }));
vi.mock("@/lib/nativePush", () => ({ unregisterPushOnSignOut: vi.fn(async () => {}) }));
vi.mock("@/lib/lastRoute", () => ({ clearRememberedRoute: vi.fn() }));
vi.mock("@/lib/queryPersister", async (orig) => ({ ...(await orig<object>()), removePersistedClient: vi.fn(async () => {}) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  holder.client = null;
  // useAuthReady subscribes once per module; each case gets its own client.
  vi.resetModules();
});

type Sent = { path: string; auth: string };

async function signedInScreen(answerRoles: (n: number) => Response) {
  const sent: Sent[] = [];
  let roleReads = 0;
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    sent.push({ path: url.replace(BASE, ""), auth: headers.get("Authorization") ?? "" });
    if (url.includes("/rest/v1/rpc/feature_switches_for_me")) return Promise.resolve(json({ switch_canary: false }));
    if (url.includes("/rest/v1/user_roles")) return Promise.resolve(answerRoles(roleReads++));
    if (url.includes("/rest/v1/profiles")) return Promise.resolve(json([{ user_id: "OLD", full_name: "Old" }]));
    if (url.includes("/auth/v1/logout")) return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(json([]));
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionOf("OLD")));
  const { signOutAwareFetch } = await import("@/lib/signOutAbort");
  holder.client = createClient(BASE, "pk", {
    auth: { storage: localStorage, storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: signOutAwareFetch },
  });
  const { queryClient } = await import("@/lib/queryClient");
  const { useFeature } = await import("@/hooks/useFeature");
  const { useCurrentUser } = await import("@/hooks/useCurrentUser");
  function Screen() {
    useFeature("switch_canary");
    useCurrentUser();
    return null;
  }
  const wrap = (c: ReactNode) => createElement(QueryClientProvider, { client: queryClient }, c);
  render(wrap(createElement(Screen)));
  return { sent };
}

const SIGNED_IN_READS = /\/rest\/v1\/(rpc\/feature_switches_for_me|user_roles|profiles)/;

describe("A3-L10: Log out sends no signed-in read afterwards", () => {
  it("feature_switches_for_me, user_roles and profiles are not read again after sign-out", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sent } = await signedInScreen(() => json([]));
    await waitFor(() => {
      expect(sent.some((s) => s.path.includes("feature_switches_for_me") && s.auth === "Bearer at-OLD")).toBe(true);
      expect(sent.some((s) => s.path.includes("user_roles") && s.auth === "Bearer at-OLD")).toBe(true);
    });
    const { signOutWithPushCleanup } = await import("@/lib/authSignOut");
    const from = sent.length;
    await act(async () => {
      await signOutWithPushCleanup();
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(sent.slice(from).some((s) => s.path.includes("/auth/v1/logout"))).toBe(true);
    const after = sent.slice(from).filter((s) => SIGNED_IN_READS.test(s.path));
    expect(after, JSON.stringify(after)).toEqual([]);
    quiet.mockRestore();
  });

  it("the admin-role retries stop at sign-out", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    // Every role read fails, so the lookup retries (3 tries, 250 ms then 500 ms apart).
    const { sent } = await signedInScreen(() => json({ message: "boom", code: "XX000" }, 500));
    await waitFor(() => expect(sent.filter((s) => s.path.includes("user_roles")).length).toBeGreaterThan(0));
    const { signOutWithPushCleanup } = await import("@/lib/authSignOut");
    const from = sent.length;
    await act(async () => {
      await signOutWithPushCleanup();
      await new Promise((r) => setTimeout(r, 1_200));
    });
    const after = sent.slice(from).filter((s) => SIGNED_IN_READS.test(s.path));
    expect(after, JSON.stringify(after)).toEqual([]);
    quiet.mockRestore();
  });
});
