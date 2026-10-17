/**
 * Q1804: on complete-signup's NO-SESSION path a birthday is ignored.
 *
 * THE DEFECT (lh-authz-rls re-review of 44ca75e95, finding #3). complete-signup
 * accepts a call with no JWT when the body names a `userId` that is under 30
 * minutes old, has never signed in and has an empty bio: that is how the
 * sign-up form finishes an account before the email is confirmed. Since
 * 44ca75e95 a birthday under 18 is SAVED rather than refused (owner,
 * 2026-10-13, Q1586(c)), and once saved it is locked (lock_under_18_birthday,
 * plus this function's own "only support can correct it" refusal). So anyone
 * who learned a brand-new account's id could, inside that window, send an
 * under-18 birthday on the account's behalf and lock it out of Apply and Post
 * until support stepped in. No client sends a birthday on that path (the
 * sign-up form sends the 18+ box, `ageAttested`, and no birthday, in the
 * current tree and in iOS build 7119's tree c16b0f0dc alike), so the fix
 * drops it there: a birthday comes only from a signed-in member.
 *
 * These run the real function through the edge harness; the double stands in
 * for Supabase only.
 */
//
// Registered mutation: taking the birthday from the body on every path again
// is the defect exactly (the no-session under-18 birthday is written).
// Since Q1885 the no-session path is default-deny (NO_SESSION_FIELDS): the
// defect is the birthday appearing in that allowlist.
// @mutate supabase/functions/complete-signup/index.ts | const NO_SESSION_FIELDS: Readonly<Record<string, string>> = { | const NO_SESSION_FIELDS: Readonly<Record<string, string>> = { dateOfBirth: "mutant",
import { describe, it, expect, beforeEach, afterEach, type MockInstance } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { completionUpdate } from "./mocks/completeSignupWrites";
import { resetSharedMocks } from "./mocks/shared";
import { stubSignupCapRead } from "./mocks/signupCapFetch";

const USER_ID = "18041804-1804-1804-1804-180418041804";
/** Under 18 on any date this suite can run (born 2015). */
const UNDER_18 = "2015-06-01";
const ADULT = "1990-06-01";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return loadEdgeFunction("complete-signup");
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

/** A signed-in member (JWT path) with no saved birthday. */
function seedSignedIn() {
  scenario.authUser = { id: USER_ID, email: "member@test.com" };
  scenario.reads.profiles = {
    rows: [{ bio: null, date_of_birth: null, full_name: "Dana R", user_id: USER_ID }],
  };
  scenario.writeSelectRows.profiles = [{ user_id: USER_ID }];
}

function profileUpdate(): Record<string, unknown> | undefined {
  // The completion, not the no-session claim before it (Q1887).
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

describe("Q1804: complete-signup takes a birthday only from a signed-in member", () => {
  let capRead: MockInstance<typeof fetch>;
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    capRead = stubSignupCapRead();
  });
  afterEach(() => capRead.mockRestore());

  it("a no-session call with an under-18 birthday writes no date_of_birth", async () => {
    seedFreshSignup();
    const fn = await load();
    const res = await fn.fetch(fn.request({ body: body({ userId: USER_ID, dateOfBirth: UNDER_18 }) }));
    expect(res.status).toBe(200);
    const update = profileUpdate();
    // The completion itself still happens (the rest of the form is saved) ...
    expect(update?.zip_code).toBe("70802");
    // ... but the birthday the caller sent is not.
    expect(update).toBeDefined();
    expect(update).not.toHaveProperty("date_of_birth");
  });

  it("a no-session call with an adult birthday writes no date_of_birth either", async () => {
    seedFreshSignup();
    const fn = await load();
    const res = await fn.fetch(fn.request({ body: body({ userId: USER_ID, dateOfBirth: ADULT }) }));
    expect(res.status).toBe(200);
    expect(profileUpdate()).not.toHaveProperty("date_of_birth");
  });

  it("on the no-session path a birthday no longer stands in for the 18+ box", async () => {
    seedFreshSignup();
    const fn = await load();
    const res = await fn.fetch(
      fn.request({ body: body({ userId: USER_ID, dateOfBirth: ADULT, ageAttested: undefined }) }),
    );
    expect(res.status).toBe(403);
    // The 18+ refusal itself, not some unrelated 403 (lh-authz-rls review note).
    expect(((await res.json()) as { error?: string }).error).toBe(
      "You must confirm you are at least 18 years old to use Helpr.",
    );
    expect(profileUpdate()).toBeUndefined();
  });

  it("a signed-in member's birthday is still saved, under 18 included (Q1586(c))", async () => {
    seedSignedIn();
    const fn = await load();
    const res = await fn.fetch(
      fn.request({ body: body({ dateOfBirth: UNDER_18 }), headers: { Authorization: "Bearer user-jwt" } }),
    );
    expect(res.status).toBe(200);
    expect(profileUpdate()?.date_of_birth).toBe(UNDER_18);
  });
});
