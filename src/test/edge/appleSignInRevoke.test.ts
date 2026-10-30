/**
 * Q1791 (App Store Review 5.1.1(v)): deleting an account revokes its Sign in
 * with Apple token. Pins:
 *   - revokeAppleSignIn (_shared/appleSignIn.ts): ONE POST to Apple's
 *     /auth/revoke with the stored refresh token, the stored client id and a
 *     client secret signed for that client; the row goes only after Apple says
 *     200; no token -> no call; no key -> no call, reported failed;
 *   - exchangeAppleCode: the code goes to /auth/token and Apple's refresh token
 *     comes back; nothing is sent without the key;
 *   - purgeAccount (the one path every delete function runs before
 *     auth.admin.deleteUser) makes exactly one revoke call for an Apple-linked
 *     account, before the purge_user_data RPC, and does not let a failed revoke
 *     block the deletion;
 *   - every edge function that calls auth.admin.deleteUser runs purgeAccount
 *     first (inventory from source).
 *
 * @mutate supabase/functions/_shared/accountPurge.ts |   await revokeAppleTokenIfAny(admin, userId, steps); |   void revokeAppleTokenIfAny;
 * @mutate supabase/functions/_shared/appleSignIn.ts |   if (!data?.refresh_token) return { status: "no_token" }; |   if (!data?.refresh_token) return { status: "revoked" };
 * @mutate supabase/functions/_shared/appleSignIn.ts |   if (!res.ok) return { status: "failed", detail: `apple answered ${res.status}` }; |
 * @mutate supabase/functions/_shared/appleSignIn.ts |         token_type_hint: "refresh_token", |         token_type_hint: "access_token",
 * @mutate supabase/functions/_shared/appleSignIn.ts |     optionalClaims: { iat: now, exp: now + 300, aud: APPLE_AUDIENCE, sub: clientId }, |     optionalClaims: { iat: now, exp: now + 300, aud: APPLE_AUDIENCE, sub: "com.Helpr" },
 * @mutate supabase/functions/_shared/appleSignIn.ts |   if (!key) return { ok: false, reason: "not_configured" }; |
 * @mutate supabase/functions/_shared/appleSignIn.ts |   if (claims?.iss !== APPLE_AUDIENCE) return null; |
 * @mutate supabase/functions/_shared/appleSignIn.ts |     if (i?.provider !== "apple") continue; |
 */
import { generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blankComments } from "../helpers/blankNonCode";

const PURGE = "../../../supabase/functions/_shared/accountPurge";
type Key = { keyId: string; teamId: string; privateKey: string };
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
// A literal path, so knip sees which exports this test reads.
const siwa = (await import("../../../supabase/functions/_shared/appleSignIn")) as {
  APPLE_REVOKE_URL: string;
  APPLE_TOKEN_URL: string;
  revokeAppleSignIn: (admin: unknown, userId: string, key: Key | null, f: FetchLike) => Promise<{ status: string; detail?: string }>;
  exchangeAppleCode: (key: Key | null, clientId: string, code: string, subs: string[], f: FetchLike) => Promise<Record<string, unknown>>;
  callerAppleSubs: (identities: unknown) => string[];
  appleIdTokenSubject: (idToken: unknown, clientId: string) => string | null;
};

const USER = "11111111-2222-4333-8444-555555555555";
const PEM = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const KEY: Key = { keyId: "ABCDEFGHIJ", teamId: "TEAM123456", privateKey: PEM };

type Call = { url: string; form: URLSearchParams };
function recorder(status = 200, json: unknown = {}) {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, form: new URLSearchParams(String(init.body)) });
    return new Response(JSON.stringify(json), { status });
  };
  return { calls, f };
}

/** apple_sign_in_tokens stand-in: one optional row, records deletes. */
function tokenTable(row: { refresh_token: string; client_id: string } | null) {
  const state = { row, deleted: 0 };
  const admin = {
    from(table: string) {
      expect(table).toBe("apple_sign_in_tokens");
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: state.row, error: null }),
        delete: () => ({ eq: () => ({ select: async () => { state.deleted++; state.row = null; return { data: [{ user_id: USER }], error: null }; } }) }),
      };
      return q;
    },
  };
  return { admin, state };
}

const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
const SUB = "000123.mine.0456";
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** An id_token shaped like the one Apple's /auth/token returns. */
const idTok = (c: Record<string, unknown>) => `${b64u({ alg: "RS256" })}.${b64u(c)}.sig`;
const APPLE_ID = (sub: string, aud: unknown = "com.Helpr") => idTok({ iss: "https://appleid.apple.com", aud, sub });

describe("revokeAppleSignIn", () => {
  it("makes exactly one revoke call with the stored token and client, then forgets the token", async () => {
    const { admin, state } = tokenTable({ refresh_token: "r.tok", client_id: "com.Helpr" });
    const { calls, f } = recorder(200);
    expect(await siwa.revokeAppleSignIn(admin, USER, KEY, f)).toEqual({ status: "revoked" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://appleid.apple.com/auth/revoke");
    expect(calls[0].form.get("token")).toBe("r.tok");
    expect(calls[0].form.get("token_type_hint")).toBe("refresh_token");
    expect(calls[0].form.get("client_id")).toBe("com.Helpr");
    const c = claims(calls[0].form.get("client_secret") ?? "");
    expect(c).toMatchObject({ iss: "TEAM123456", sub: "com.Helpr", aud: "https://appleid.apple.com" });
    expect(c.exp - c.iat).toBeLessThanOrEqual(300);
    expect(state.deleted).toBe(1);
  });

  it("the client secret names the client the token was issued to (web Services ID)", async () => {
    const { admin } = tokenTable({ refresh_token: "r.web", client_id: "com.Helpr.signin" });
    const { calls, f } = recorder(200);
    await siwa.revokeAppleSignIn(admin, USER, KEY, f);
    expect(calls[0].form.get("client_id")).toBe("com.Helpr.signin");
    expect(claims(calls[0].form.get("client_secret") ?? "").sub).toBe("com.Helpr.signin");
  });

  it("no stored token: no call, no_token", async () => {
    const { admin } = tokenTable(null);
    const { calls, f } = recorder(200);
    expect(await siwa.revokeAppleSignIn(admin, USER, KEY, f)).toEqual({ status: "no_token" });
    expect(calls).toHaveLength(0);
  });

  it("Apple refuses: failed, and the row stays for a retry", async () => {
    const { admin, state } = tokenTable({ refresh_token: "r.tok", client_id: "com.Helpr" });
    const { calls, f } = recorder(400);
    const out = await siwa.revokeAppleSignIn(admin, USER, KEY, f);
    expect(out.status).toBe("failed");
    expect(calls).toHaveLength(1);
    expect(state.deleted).toBe(0);
  });

  it("no Sign in with Apple key: nothing is sent, reported failed (not silently 'revoked')", async () => {
    const { admin, state } = tokenTable({ refresh_token: "r.tok", client_id: "com.Helpr" });
    const { calls, f } = recorder(200);
    const out = await siwa.revokeAppleSignIn(admin, USER, null, f);
    expect(out.status).toBe("failed");
    expect(out.detail).toMatch(/not_configured/);
    expect(calls).toHaveLength(0);
    expect(state.deleted).toBe(0);
  });

  it("a stored client id that is not ours is refused before any call", async () => {
    const { admin } = tokenTable({ refresh_token: "r.tok", client_id: "com.evil" });
    const { calls, f } = recorder(200);
    expect((await siwa.revokeAppleSignIn(admin, USER, KEY, f)).status).toBe("failed");
    expect(calls).toHaveLength(0);
  });
});

describe("exchangeAppleCode", () => {
  it("trades the code at /auth/token for Apple's refresh token", async () => {
    const { calls, f } = recorder(200, { refresh_token: "r.new", access_token: "a", id_token: APPLE_ID(SUB) });
    expect(await siwa.exchangeAppleCode(KEY, "com.Helpr", "c.code", [SUB], f)).toEqual({ ok: true, refreshToken: "r.new" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://appleid.apple.com/auth/token");
    expect(calls[0].form.get("grant_type")).toBe("authorization_code");
    expect(calls[0].form.get("code")).toBe("c.code");
    expect(claims(calls[0].form.get("client_secret") ?? "").sub).toBe("com.Helpr");
  });

  it("no key: not_configured and nothing sent", async () => {
    const { calls, f } = recorder(200, { refresh_token: "r" });
    expect(await siwa.exchangeAppleCode(null, "com.Helpr", "c", [SUB], f)).toEqual({ ok: false, reason: "not_configured" });
    expect(calls).toHaveLength(0);
  });

  it("Apple refuses or omits the refresh token: not stored", async () => {
    expect((await siwa.exchangeAppleCode(KEY, "com.Helpr", "c", [SUB], recorder(400).f)).reason).toBe("apple_refused");
    expect((await siwa.exchangeAppleCode(KEY, "com.Helpr", "c", [SUB], recorder(200, { id_token: APPLE_ID(SUB) }).f)).reason).toBe("no_refresh_token");
  });

  it("PLANTED MISMATCH: a code issued to another Apple account never yields its refresh token", async () => {
    const out = await siwa.exchangeAppleCode(KEY, "com.Helpr", "c", [SUB], recorder(200, { refresh_token: "r.other", id_token: APPLE_ID("000999.other.0111") }).f);
    expect(out).toEqual({ ok: false, reason: "identity_mismatch" });
    expect(JSON.stringify(out)).not.toContain("r.other");
  });

  it("no id_token, a caller with no Apple sub, or a token for another client: identity_mismatch", async () => {
    const r = (body: Record<string, unknown>, subs = [SUB]) => siwa.exchangeAppleCode(KEY, "com.Helpr", "c", subs, recorder(200, body).f);
    expect((await r({ refresh_token: "r" })).reason).toBe("identity_mismatch");
    expect((await r({ refresh_token: "r", id_token: APPLE_ID(SUB) }, [])).reason).toBe("identity_mismatch");
    expect((await r({ refresh_token: "r", id_token: APPLE_ID(SUB, "com.other") })).reason).toBe("identity_mismatch");
  });
});

describe("appleIdTokenSubject / callerAppleSubs", () => {
  it("reads sub only from an Apple-issued token for our client", () => {
    expect(siwa.appleIdTokenSubject(APPLE_ID(SUB), "com.Helpr")).toBe(SUB);
    expect(siwa.appleIdTokenSubject(APPLE_ID(SUB, ["x", "com.Helpr"]), "com.Helpr")).toBe(SUB);
    expect(siwa.appleIdTokenSubject(APPLE_ID(SUB, "com.Helpr.signin"), "com.Helpr")).toBeNull();
    expect(siwa.appleIdTokenSubject(idTok({ iss: "https://evil.example", aud: "com.Helpr", sub: SUB }), "com.Helpr")).toBeNull();
    expect(siwa.appleIdTokenSubject(idTok({ iss: "https://appleid.apple.com", aud: "com.Helpr" }), "com.Helpr")).toBeNull();
    expect(siwa.appleIdTokenSubject("not-a-jwt", "com.Helpr")).toBeNull();
    expect(siwa.appleIdTokenSubject("a.%%%.c", "com.Helpr")).toBeNull();
    expect(siwa.appleIdTokenSubject(undefined, "com.Helpr")).toBeNull();
  });

  it("the caller's Apple subs come only from provider='apple' identities", () => {
    expect(siwa.callerAppleSubs([
      { provider: "email", identity_data: { sub: "email-sub" } },
      { provider: "google", identity_data: { sub: "google-sub" } },
      { provider: "apple", identity_data: { sub: SUB } },
      { provider: "apple", identity_data: { sub: "" } },
      { provider: "apple", identity_data: null },
    ])).toEqual([SUB]);
    expect(siwa.callerAppleSubs(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// purgeAccount end to end with a permissive PostgREST stand-in.
// ---------------------------------------------------------------------------
const env: Record<string, string> = {};
const g = globalThis as unknown as { Deno?: unknown; fetch: typeof fetch };
let realFetch: typeof fetch;
let savedDeno: unknown;
beforeEach(() => {
  realFetch = g.fetch;
  savedDeno = g.Deno;
  g.Deno = { env: { get: (n: string) => env[n] } };
});
afterEach(() => {
  g.fetch = realFetch;
  g.Deno = savedDeno;
  for (const k of Object.keys(env)) delete env[k];
});

/** Every query answers "nothing here, no error"; apple_sign_in_tokens holds one row; purge_user_data succeeds. */
function permissiveAdmin(order: string[], tokenRow: Record<string, string> | null) {
  const empty = { data: [], error: null, count: 0 };
  function chain(table: string): unknown {
    const result = () => (table === "apple_sign_in_tokens" ? { data: tokenRow ? [{ user_id: USER }] : [], error: null } : empty);
    const p: Record<string, unknown> = {};
    const self = new Proxy(p, {
      get(_t, prop: string) {
        if (prop === "then") return (res: (v: unknown) => void) => res(result());
        if (prop === "maybeSingle" || prop === "single") {
          return async () => ({ data: table === "apple_sign_in_tokens" ? tokenRow : null, error: null });
        }
        if (prop === "delete" && table === "apple_sign_in_tokens") order.push("apple_row_delete");
        return () => self;
      },
    });
    return self;
  }
  return {
    from: (t: string) => chain(t),
    rpc: async (name: string) => {
      order.push(`rpc:${name}`);
      return { data: name === "purge_user_data" ? { ok: true } : null, error: null };
    },
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
      listBuckets: async () => ({ data: [], error: null }),
    },
  };
}

describe("purgeAccount revokes an Apple-linked account's token (every delete path runs it)", () => {
  const purge = async () =>
    ((await import(/* @vite-ignore */ PURGE)) as {
      purgeAccount: (admin: unknown, userId: string) => Promise<{ ok: boolean; steps: Array<{ step: string; ok: boolean; detail: string }> }>;
    }).purgeAccount;

  it("exactly one revoke call, before purge_user_data", async () => {
    Object.assign(env, { APPLE_SIGNIN_PRIVATE_KEY: PEM, APPLE_SIGNIN_KEY_ID: "ABCDEFGHIJ", APPLE_SIGNIN_TEAM_ID: "TEAM123456" });
    const order: string[] = [];
    const revokes: Call[] = [];
    g.fetch = (async (url: string, init: RequestInit) => {
      if (String(url).startsWith("https://appleid.apple.com/")) {
        order.push("apple_revoke");
        revokes.push({ url: String(url), form: new URLSearchParams(String(init.body)) });
        return new Response("", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const out = await (await purge())(permissiveAdmin(order, { refresh_token: "r.tok", client_id: "com.Helpr" }), USER);
    expect(revokes).toHaveLength(1);
    expect(revokes[0].url).toBe("https://appleid.apple.com/auth/revoke");
    expect(revokes[0].form.get("token")).toBe("r.tok");
    expect(out.steps.find((s) => s.step === "apple_revoke")).toEqual({ step: "apple_revoke", ok: true, detail: "revoked" });
    const purgeAt = order.indexOf("rpc:purge_user_data");
    expect(order.indexOf("apple_revoke")).toBeGreaterThanOrEqual(0);
    expect(purgeAt).toBeGreaterThan(0);
    expect(order.indexOf("apple_revoke")).toBeLessThan(purgeAt);
  });

  it("a failed revoke (no key) is recorded but does not block the deletion", async () => {
    g.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const run = purge();
    // Same account, revoke failing (no key) vs no Apple token at all: the outcome must not change.
    const failed = await (await run)(permissiveAdmin([], { refresh_token: "r.tok", client_id: "com.Helpr" }), USER);
    const none = await (await run)(permissiveAdmin([], null), USER);
    expect(failed.steps.find((s) => s.step === "apple_revoke")?.ok).toBe(false);
    expect(none.steps.find((s) => s.step === "apple_revoke")).toEqual({ step: "apple_revoke", ok: true, detail: "no_token" });
    expect({ ok: failed.ok, reason: (failed as { reason?: string }).reason }).toEqual({
      ok: none.ok,
      reason: (none as { reason?: string }).reason,
    });
  });
});

describe("every function that deletes an auth user runs purgeAccount first", () => {
  const root = join(process.cwd(), "supabase", "functions");
  const files = readdirSync(root, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? readdirSync(join(root, d.name)).filter((f) => f.endsWith(".ts")).map((f) => join(root, d.name, f)) : []))
    .filter((p) => !/\.test\.ts$/.test(p) && existsSync(p))
    .map((p) => ({ p, src: blankComments(readFileSync(p, "utf8")) }))
    .filter(({ src }) => /auth\.admin\.deleteUser\(/.test(src));

  it("finds the delete paths (inventory floor)", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files.map((f) => [f.p.slice(root.length + 1), f.src]))("%s", (_name, src) => {
    const purgeAt = src.search(/purgeAccount\(/);
    expect(purgeAt, "calls purgeAccount").toBeGreaterThanOrEqual(0);
    expect(purgeAt).toBeLessThan(src.search(/auth\.admin\.deleteUser\(/));
  });
});
