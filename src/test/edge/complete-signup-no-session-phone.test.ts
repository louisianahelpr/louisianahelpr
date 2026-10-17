/**
 * On complete-signup's NO-SESSION path a phone is ignored (the Q1804 follow-up).
 *
 * THE DEFECT (lh-authz-rls review of the Q1804 fix, finding #1). complete-signup
 * accepts a call with no JWT when the body names a `userId` that is under 30
 * minutes old, has never signed in and has an empty bio (how the sign-up form
 * finishes an account before the email is confirmed). A `phone` in that body
 * went straight to `enforce_retained_ban(p_user_id => that account, p_phone)`.
 * On prod (read-only pg_get_functiondef, 2026-10-17) a phone match there
 * inserts a user_bans row, updates profiles and files a ban-evasion flag, all
 * inside the RPC, so a stranger who learned a brand-new account's id and typed
 * a banned number got the account's real owner banned. No client sends a phone
 * on that path (Signup.tsx, in the current tree and in iOS build 7119's tree
 * c16b0f0dc alike, is the only caller and sends none), so the fix drops it: a
 * phone comes only from a signed-in member, like the birthday (Q1804).
 *
 * These run the real function through the edge harness; the double stands in
 * for Supabase only. The RPC is configured to answer a ban match, so a call
 * that reaches it is visible both in rpcCalls and as the 403 it returns.
 */
//
// Registered mutation: letting the phone through on the no-session path again
// is the defect exactly (the no-session phone reaches enforce_retained_ban).
// Since Q?signup-no-session the path is default-deny (NO_SESSION_FIELDS), so the defect
// is the phone appearing in that allowlist.
// @mutate supabase/functions/complete-signup/index.ts | const NO_SESSION_FIELDS: Readonly<Record<string, string>> = { | const NO_SESSION_FIELDS: Readonly<Record<string, string>> = { phone: "mutant",
import { describe, it, expect, beforeEach, afterEach, type MockInstance } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { completionUpdate } from "./mocks/completeSignupWrites";
import { resetSharedMocks } from "./mocks/shared";
import { stubSignupCapRead } from "./mocks/signupCapFetch";

const USER_ID = "18831883-1883-1883-1883-188318831883";
/** A number standing in for one held in retained_bans. */
const BANNED_PHONE = "+15045550123";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return loadEdgeFunction("complete-signup");
}

/** enforce_retained_ban answers a phone match, as prod does for a banned number. */
function banMatchOnPhone() {
  scenario.rpc.enforce_retained_ban = { banned: true, matched_on: "phone" };
}

/** A fresh account inside the 30-minute window, never signed in, empty profile. */
function seedFreshSignup() {
  scenario.adminUsers = {
    [USER_ID]: {
      email: "new@test.com",
      email_confirmed_at: null,
      created_at: new Date().toISOString(),
      last_sign_in_at: null,
    } as unknown as { email?: string; email_confirmed_at?: string | null },
  };
  scenario.reads.profiles = {
    rows: [{ bio: null, date_of_birth: null, full_name: "Dana R", user_id: USER_ID }],
  };
  scenario.writeSelectRows.profiles = [{ user_id: USER_ID }];
}

/** A signed-in member (JWT path). */
function seedSignedIn() {
  scenario.authUser = { id: USER_ID, email: "member@test.com" };
  scenario.adminUsers = {
    [USER_ID]: { email: "member@test.com" } as unknown as { email?: string; email_confirmed_at?: string | null },
  };
  scenario.reads.profiles = {
    rows: [{ bio: null, date_of_birth: null, full_name: "Dana R", user_id: USER_ID }],
  };
  scenario.writeSelectRows.profiles = [{ user_id: USER_ID }];
}

function banChecks() {
  return (scenario.rpcCalls ?? []).filter((c) => c.name === "enforce_retained_ban");
}

function profileUpdate(): Record<string, unknown> | undefined {
  // The completion, not the no-session claim before it (Q?signup-one-shot-atomic).
  const w = completionUpdate();
  return w?.payload as Record<string, unknown> | undefined;
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    location: "Baton Rouge",
    zipCode: "70802",
    parish: "East Baton Rouge",
    ageAttested: true,
    termsAccepted: true,
    ...overrides,
  };
}

describe("complete-signup takes a phone only from a signed-in member (Q1804 follow-up)", () => {
  let capRead: MockInstance<typeof fetch>;
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    capRead = stubSignupCapRead();
    banMatchOnPhone();
  });
  afterEach(() => capRead.mockRestore());

  it("a no-session call with a banned-match phone never runs the ban check on it", async () => {
    seedFreshSignup();
    const fn = await load();
    const res = await fn.fetch(fn.request({ body: body({ userId: USER_ID, phone: BANNED_PHONE }) }));
    expect(banChecks()).toEqual([]);
    // The owner's completion goes through; the stranger's number is not saved.
    expect(res.status).toBe(200);
    const update = profileUpdate();
    expect(update?.zip_code).toBe("70802");
    expect(update).not.toHaveProperty("phone");
  });

  it("a signed-in member's phone is still checked against retained bans (and refused on a match)", async () => {
    seedSignedIn();
    const fn = await load();
    const res = await fn.fetch(
      fn.request({ body: body({ phone: BANNED_PHONE }), headers: { Authorization: "Bearer user-jwt" } }),
    );
    expect(banChecks()).toHaveLength(1);
    expect((banChecks()[0].args as { p_phone?: string; p_user_id?: string }).p_phone).toBe(BANNED_PHONE);
    expect((banChecks()[0].args as { p_user_id?: string }).p_user_id).toBe(USER_ID);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("retained_ban");
  });
});
