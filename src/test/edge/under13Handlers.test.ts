/**
 * Q1803 (OWNER RULING 2026-10-21, COPPA), the two edge entry points, run for
 * real through the edge harness (the deletion itself, _shared/under13.ts, is
 * the double in mocks/shared.ts; its behaviour is pinned in under13.test.ts):
 *
 * complete-signup: a SIGNED-IN member sending an under-13 birthday is
 * answered 403 { code: "under_13", error: "You must be 13 or older to use
 * Louisiana Helpr" }, the account is deleted, and no birthday is written. A
 * no-session call cannot send a birthday at all (Q1885), so it can never
 * delete an account (the code's own `signedIn &&` is a second lock behind
 * NO_SESSION_FIELDS; removing it alone changes no answer, so it carries no
 * mutation here: the allowlist's mutation is in complete-signup-no-session-birthday). A 13-17 birthday is still saved (Q1586(c)).
 *
 * under-13-delete: cron/service only; deletes every stamped account; an
 * account waiting on money is NOT a defect (no 500 every 5 minutes, lead
 * 2026-10-21); a purge failure is.
 *
 * @mutate supabase/functions/complete-signup/index.ts |       const out = await deleteUnder13Account(supabase, userId, alertWaitingOnMoney); |       const out = { status: "deleted" as const, detail: "" };
 * @mutate supabase/functions/complete-signup/index.ts |       if (isNaN(dob.getTime()) \|\| isFutureBirthday(effectiveDob)) { |       if (isNaN(dob.getTime())) {
 * @mutate supabase/functions/under-13-delete/index.ts |       else if (out.status === "waiting_on_money") waiting++; |       else if (out.status === "waiting_on_money") defects.record("waiting");
 * @mutate supabase/functions/under-13-delete/index.ts |       else defects.record(`${r.user_id}: ${out.detail}`); |       else deleted++;
 */
import { describe, it, expect, beforeEach, afterEach, type MockInstance } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { completionUpdate } from "./mocks/completeSignupWrites";
import { resetSharedMocks, under13Deletes, under13State } from "./mocks/shared";
import { stubSignupCapRead } from "./mocks/signupCapFetch";

const USER_ID = "13131313-1313-4313-8313-131313131313";
const ymdYearsAgo = (years: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};
/** Under 13 on any day this suite runs (about 11). */
const UNDER_13 = ymdYearsAgo(11);
/** Between 13 and 18 on any day this suite runs (about 15). */
const TEEN = ymdYearsAgo(15);

function env() {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key" });
}

function seedSignedIn() {
  scenario.authUser = { id: USER_ID, email: "member@test.com" };
  scenario.reads.profiles = { rows: [{ bio: null, date_of_birth: null, full_name: "Dana R", user_id: USER_ID }] };
  scenario.writeSelectRows.profiles = [{ user_id: USER_ID }];
}
function seedFreshSignup() {
  scenario.adminUsers = {
    [USER_ID]: { email: "new@test.com", email_confirmed_at: null, created_at: new Date().toISOString(), last_sign_in_at: null } as unknown as {
      email?: string;
      email_confirmed_at?: string | null;
    },
  };
  scenario.reads.profiles = { rows: [{ bio: null, date_of_birth: null, full_name: "Dana R", user_id: USER_ID }] };
  scenario.writeSelectRows.profiles = [{ user_id: USER_ID }];
}
const body = (o: Record<string, unknown> = {}) => ({ location: "Baton Rouge", zipCode: "70802", parish: "East Baton Rouge", ageAttested: true, termsAccepted: true, ...o });

describe("complete-signup: an under-13 birthday deletes the account (Q1803)", () => {
  let capRead: MockInstance<typeof fetch>;
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    capRead = stubSignupCapRead();
  });
  afterEach(() => capRead.mockRestore());

  it("a signed-in member's under-13 birthday: 403 under_13 with the ruling's sentence, deleted, nothing saved", async () => {
    seedSignedIn();
    env();
    const fn = await loadEdgeFunction("complete-signup");
    const res = await fn.fetch(fn.request({ body: body({ dateOfBirth: UNDER_13 }), headers: { Authorization: "Bearer user-jwt" } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You must be 13 or older to use Louisiana Helpr", code: "under_13" });
    expect(under13Deletes).toEqual([USER_ID]);
    expect(completionUpdate()).toBeUndefined();
  });

  it("a deletion that could not finish leaves the account stamped for the sweep", async () => {
    seedSignedIn();
    env();
    under13State.outcome = { status: "failed", detail: "purge: storage_failed" };
    const fn = await loadEdgeFunction("complete-signup");
    const res = await fn.fetch(fn.request({ body: body({ dateOfBirth: UNDER_13 }), headers: { Authorization: "Bearer user-jwt" } }));
    expect(res.status).toBe(403);
    const stamp = scenario.writes.find((w) => w.table === "profiles" && (w.payload as Record<string, unknown>)?.under_13_blocked_at);
    expect(stamp).toBeDefined();
    expect(stamp?.payload).not.toHaveProperty("date_of_birth");
  });

  it("a birthday after today is refused as invalid, never read as a child", async () => {
    seedSignedIn();
    env();
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    const fn = await loadEdgeFunction("complete-signup");
    const res = await fn.fetch(fn.request({ body: body({ dateOfBirth: d.toISOString().slice(0, 10) }), headers: { Authorization: "Bearer user-jwt" } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toBe("Invalid date of birth.");
    expect(under13Deletes).toEqual([]);
  });

  it("a no-session call cannot send a birthday, so it never deletes an account", async () => {
    seedFreshSignup();
    env();
    const fn = await loadEdgeFunction("complete-signup");
    const res = await fn.fetch(fn.request({ body: body({ userId: USER_ID, dateOfBirth: UNDER_13 }) }));
    expect(res.status).toBe(200);
    expect(under13Deletes).toEqual([]);
    expect(completionUpdate()?.payload).not.toHaveProperty("date_of_birth");
  });

  it("a signed-in 13-17 birthday is still saved (Q1586(c)), nothing deleted", async () => {
    seedSignedIn();
    env();
    const fn = await loadEdgeFunction("complete-signup");
    const res = await fn.fetch(fn.request({ body: body({ dateOfBirth: TEEN }), headers: { Authorization: "Bearer user-jwt" } }));
    expect(res.status).toBe(200);
    expect(under13Deletes).toEqual([]);
    expect((completionUpdate()?.payload as Record<string, unknown>)?.date_of_birth).toBe(TEEN);
  });
});

describe("under-13-delete: the sweep (Q1803)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
  });

  const call = async (b: Record<string, unknown> = {}, auth = "Bearer service-key") => {
    env();
    const fn = await loadEdgeFunction("under-13-delete");
    return fn.fetch(fn.request({ body: b, headers: { Authorization: auth } }));
  };

  it("refuses a caller without the service key", async () => {
    const res = await call({}, "Bearer user-jwt");
    expect(res.status).toBe(401);
    expect(under13Deletes).toEqual([]);
  });

  it("deletes every stamped account", async () => {
    scenario.reads.profiles = { rows: [{ user_id: "a", under_13_waiting_since: null }, { user_id: "b", under_13_waiting_since: null }] };
    const res = await call();
    expect(res.status).toBe(200);
    expect(under13Deletes).toEqual(["a", "b"]);
    expect(await res.json()).toMatchObject({ deleted: 2, waitingOnMoney: 0 });
  });

  it("an account waiting on money is not a defect (200, counted), never an alert every run", async () => {
    scenario.reads.profiles = { rows: [{ user_id: "a", under_13_waiting_since: "2026-10-21T00:00:00Z" }] };
    under13State.outcome = { status: "waiting_on_money", reason: "job", firstTime: false };
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: 0, waitingOnMoney: 1, defects: 0 });
  });

  it("a purge that fails answers 500 (a real defect)", async () => {
    scenario.reads.profiles = { rows: [{ user_id: "a", under_13_waiting_since: null }] };
    under13State.outcome = { status: "failed", detail: "purge: storage_failed" };
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ defects: 1 });
  });
});
