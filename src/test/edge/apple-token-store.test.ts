/**
 * Q1791: apple-token-store keeps a Sign in with Apple refresh token ONLY for
 * the Apple account the caller is signed in as.
 *
 * The function trades a one-time code the client sends for Apple's refresh
 * token. Without a check, a member could send a code issued to a DIFFERENT
 * Apple account (another device, someone else's sign-in) and the server would
 * store that account's token under the caller and later revoke it as theirs.
 * The id_token Apple returns from the same /auth/token call names the Apple
 * user (`sub`) the code belongs to; it must equal the caller's own Apple
 * identity (auth.identities provider='apple', identity_data.sub), or nothing
 * is stored.
 *
 * Runs the REAL handler through the edge harness: the real _shared/appleSignIn
 * exchange and identity check, with Apple's endpoint stubbed on fetch and the
 * Supabase double recording every write.
 *
 * Registered mutations (each turns this file RED on its own):
 *   (1) the store function stops refusing a caller with no Apple sub on record
 *       before it calls Apple;
 *   (2) the exchange stops comparing the id_token's sub with the caller's;
 *   (3) the exchange stops checking the id_token's audience.
 * @mutate supabase/functions/apple-token-store/index.ts |   if (appleSubs.length === 0) return errorResponse("not_apple", 403, corsHeaders); |
 * @mutate supabase/functions/_shared/appleSignIn.ts |   if (!sub \|\| !callerSubs.includes(sub)) return { ok: false, reason: "identity_mismatch" }; |   if (!sub) return { ok: false, reason: "identity_mismatch" };
 * @mutate supabase/functions/_shared/appleSignIn.ts |   if (!aud.includes(clientId)) return null; |
 */
import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { resetEnv, setEnv } from "./mocks/deno-runtime";
import { resetSharedMocks } from "./mocks/shared";
import { resetSupabaseMock, scenario } from "./mocks/supabase";

const USER = "11111111-2222-4333-8444-555555555555";
const MY_SUB = "000123.mine.0456";
const OTHER_SUB = "000999.someone-else.0111";
const PEM = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** An id_token shaped like Apple's (header.payload.signature). */
const idToken = (claims: Record<string, unknown>) => `${b64u({ alg: "RS256", kid: "k" })}.${b64u(claims)}.sig`;

let realFetch: typeof fetch;
let appleCalls = 0;
function appleAnswers(body: Record<string, unknown>) {
  globalThis.fetch = (async (url: string) => {
    if (String(url).startsWith("https://appleid.apple.com/")) {
      appleCalls++;
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
}

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    APPLE_SIGNIN_PRIVATE_KEY: PEM,
    APPLE_SIGNIN_KEY_ID: "ABCDEFGHIJ",
    APPLE_SIGNIN_TEAM_ID: "TEAM123456",
  });
  return loadEdgeFunction("apple-token-store");
}

const call = (h: EdgeHarness) =>
  h.fetch(h.request({
    method: "POST",
    headers: { Authorization: "Bearer user-jwt" },
    body: { authorizationCode: "c.one-time", clientId: "com.Helpr" },
  }));

const tokenWrites = () => scenario.writes.filter((w) => w.table === "apple_sign_in_tokens");

beforeEach(() => {
  resetEnv();
  resetSupabaseMock();
  resetSharedMocks();
  realFetch = globalThis.fetch;
  appleCalls = 0;
  scenario.authUser = {
    id: USER,
    email: "me@test.com",
    identities: [
      { provider: "email", identity_data: { sub: USER } },
      { provider: "apple", identity_data: { sub: MY_SUB } },
    ],
  } as unknown as { id: string };
  scenario.writeSelectRows.apple_sign_in_tokens = [{ user_id: USER }];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("apple-token-store stores a token only for the caller's own Apple account", () => {
  it("the code is the caller's (id_token sub matches): stored once, under the caller", async () => {
    appleAnswers({ refresh_token: "r.mine", id_token: idToken({ iss: "https://appleid.apple.com", aud: "com.Helpr", sub: MY_SUB }) });
    const res = await call(await load());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: true });
    expect(appleCalls).toBe(1);
    expect(tokenWrites()).toHaveLength(1);
    expect(tokenWrites()[0].payload).toMatchObject({ user_id: USER, refresh_token: "r.mine", client_id: "com.Helpr" });
  });

  it("PLANTED MISMATCH: the code belongs to another Apple account -> refused, nothing stored", async () => {
    appleAnswers({ refresh_token: "r.someone-else", id_token: idToken({ iss: "https://appleid.apple.com", aud: "com.Helpr", sub: OTHER_SUB }) });
    const res = await call(await load());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ stored: false, reason: "identity_mismatch" });
    expect(JSON.stringify(body)).not.toContain("r.someone-else");
    expect(appleCalls).toBe(1);
    expect(tokenWrites()).toHaveLength(0);
  });

  it("Apple returns no id_token: refused, nothing stored", async () => {
    appleAnswers({ refresh_token: "r.x" });
    const res = await call(await load());
    expect(res.status).toBe(403);
    expect(tokenWrites()).toHaveLength(0);
  });

  it("the id_token was issued to another client: refused, nothing stored", async () => {
    appleAnswers({ refresh_token: "r.x", id_token: idToken({ iss: "https://appleid.apple.com", aud: "com.other.app", sub: MY_SUB }) });
    const res = await call(await load());
    expect(res.status).toBe(403);
    expect(tokenWrites()).toHaveLength(0);
  });

  it("an Apple identity with no sub on record: not_apple, Apple is never called", async () => {
    scenario.authUser = { id: USER, identities: [{ provider: "apple", identity_data: {} }] } as unknown as { id: string };
    appleAnswers({ refresh_token: "r.x", id_token: idToken({ iss: "https://appleid.apple.com", aud: "com.Helpr", sub: MY_SUB }) });
    const res = await call(await load());
    expect(res.status).toBe(403);
    expect(appleCalls).toBe(0);
    expect(tokenWrites()).toHaveLength(0);
  });
});
