/**
 * Audit 11-23: an email sign-up never stored its 18+ attestation. complete-signup checked `ageAttested` (the sign-up
 * form's one consent box) and refused without it, but wrote nothing, while a Google/Apple sign-up's tick on Complete
 * Profile lands in profiles.age_attested_at (migration 20261014205016). Measured on prod 2026-11-23 (read-only, the
 * last 30 days, non-legacy profiles with accepted_terms_at): email 56 completed, 0 with age_attested_at; apple 11/11;
 * google 9/9. Now the email path writes the same column on the same UPDATE as the consent (the column's trigger,
 * trg_profiles_pin_age_attested_at, stamps now() and keeps the first one).
 *
 * Executes the real function through the edge harness; only Supabase itself is mocked.
 *
 * @mutate supabase/functions/complete-signup/index.ts | if (ageAttested === true) updateData.age_attested_at = consentAt; | void 0;
 */
import { describe, it, expect, beforeEach, afterEach, type MockInstance } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { completionUpdate } from "./mocks/completeSignupWrites";
import { resetSharedMocks } from "./mocks/shared";
import { stubSignupCapRead } from "./mocks/signupCapFetch";

const USER_ID = "11111111-1111-1111-1111-1111111111a8";

async function load(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key" });
  return loadEdgeFunction("complete-signup");
}

/** The no-session initial completion the sign-up form uses: a fresh, never-signed-in auth user, an empty profile. */
function seedFreshSignup() {
  scenario.adminUsers = {
    [USER_ID]: {
      email: "age.attested@example.com",
      email_confirmed_at: null,
      created_at: new Date().toISOString(),
      last_sign_in_at: null,
    } as unknown as { email?: string; email_confirmed_at?: string | null },
  };
  scenario.reads.profiles = { rows: [{ bio: null, full_name: "Ada Test", location: null, user_id: USER_ID }] };
  scenario.writeSelectRows.profiles = [{ user_id: USER_ID }];
}

/** Exactly what the one-screen sign-up form sends (src/pages/auth/Signup.tsx). */
function signupBody(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER_ID, avatarBase64: null, avatarExt: null, avatarContentType: null, bio: "", location: "", zipCode: "",
    parish: null, marketingConsent: false, ageAttested: true, termsAccepted: true, referralCode: null, ...overrides,
  };
}

describe("complete-signup stores an email sign-up's 18+ attestation", () => {
  let capRead: MockInstance<typeof fetch>;
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    capRead = stubSignupCapRead();
  });
  afterEach(() => capRead.mockRestore());

  it("writes age_attested_at on the completion UPDATE, beside the consent", async () => {
    seedFreshSignup();
    const fn = await load();
    const res = await fn.fetch(fn.request({ body: signupBody() }));
    expect(res.status).toBe(200);
    const update = completionUpdate()?.payload as Record<string, unknown> | undefined;
    expect(update).toBeDefined();
    expect(typeof update!.age_attested_at).toBe("string");
    expect(Number.isNaN(Date.parse(String(update!.age_attested_at)))).toBe(false);
    expect(update!.age_attested_at).toBe(update!.accepted_terms_at);
  });

  it("without the box there is no completion at all (the age gate still refuses)", async () => {
    seedFreshSignup();
    const fn = await load();
    const res = await fn.fetch(fn.request({ body: signupBody({ ageAttested: false }) }));
    expect(res.status).toBe(403);
    expect(completionUpdate()).toBeUndefined();
  });
});
