/**
 * postRows retries as anon when the session's token is refused (Q331).
 *
 * 401: the token is no longer accepted. 409: the token is still valid but its
 * account was deleted, so the user foreign keys on error_logs /
 * analytics_events (20260926034714) refuse a row naming it with 23503. Either
 * way the batch is resent once with the publishable key and user_id null.
 *
 * @mutate src/lib/restInsert.ts | (res.status === 401 \|\| res.status === 409) && token | res.status === 401 && token
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postRows } from "./restInsert";

const REF = new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname.split(".")[0];

describe("postRows anon retry", () => {
  const calls: { auth: string; body: unknown[] }[] = [];
  let statuses: number[] = [];

  beforeEach(() => {
    calls.length = 0;
    localStorage.setItem(
      `sb-${REF}-auth-token`,
      JSON.stringify({ access_token: "user-jwt", expires_at: Math.floor(Date.now() / 1000) + 3600 }),
    );
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ auth: String((init.headers as Record<string, string>).Authorization), body: JSON.parse(String(init.body)) });
      return new Response(null, { status: statuses.shift() ?? 201 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const rowsFor = (asUser: boolean) => [{ event: "e", user_id: asUser ? "deleted-user" : null }];

  it("409 (account deleted, token still valid) resends once as anon with user_id null", async () => {
    statuses = [409, 201];
    const status = await postRows("analytics_events", ["event", "user_id"], rowsFor);
    expect(status).toBe(201);
    expect(calls).toHaveLength(2);
    expect(calls[0].auth).toBe("Bearer user-jwt");
    expect(calls[1].auth).not.toBe("Bearer user-jwt");
    expect(calls[1].body).toEqual([{ event: "e", user_id: null }]);
  });

  it("401 still resends as anon", async () => {
    statuses = [401, 201];
    expect(await postRows("analytics_events", ["event", "user_id"], rowsFor)).toBe(201);
    expect(calls).toHaveLength(2);
  });

  it("any other refusal is not retried", async () => {
    statuses = [400];
    expect(await postRows("analytics_events", ["event", "user_id"], rowsFor)).toBe(400);
    expect(calls).toHaveLength(1);
  });
});
