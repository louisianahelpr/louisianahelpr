/**
 * "New member joined" is sent when the member CONFIRMS their email, never at
 * signup (owner decision, 2026-10-09 pop-up).
 *
 * THE BUG. complete-signup inserted the admin notice the moment the signup
 * form finished. Measured on prod 2026-10-09: Kaci's notice 02:45:58.8Z, her
 * signup 02:45:54.9Z, her confirmation 02:46:52.4Z; every real signup that
 * day had the notice 40-80 s BEFORE the confirm, and a signup abandoned before
 * confirming was announced too.
 *
 * NOW. The one writer is notify_admins_new_member (migration
 * 20261009223353_new_member_notice_on_email_confirm.sql), fired by the
 * auth.users confirm trigger. complete-signup never writes a notification; it
 * only asks that function, which sends nothing for an unconfirmed account and
 * at most once per member. SQL behaviour: src/test/pglite/newMemberNoticeOnConfirm.pglite.mjs;
 * static guard: src/test/newMemberNoticeOnConfirm.test.ts.
 *
 * Red on the old code: the first test fails (complete-signup inserted
 * notifications rows for an unconfirmed signup and never called the RPC).
 *
 * @mutate supabase/functions/complete-signup/index.ts |       const { data: noticeOutcome, error: noticeErr } = await supabase.rpc("notify_admins_new_member", { |       const { data: noticeOutcome, error: noticeErr } = await supabase.rpc("notify_admins_new_member_retired", {
 * @mutate supabase/functions/complete-signup/index.ts |         p_user_id: userId,\n        p_via: "complete-signup", |         p_user_id: null,\n        p_via: "complete-signup",
 */
import { describe, it, expect, beforeEach, afterEach, type MockInstance } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stubSignupCapRead } from "./mocks/signupCapFetch";

const USER_ID = "22222222-2222-2222-2222-222222222222";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return loadEdgeFunction("complete-signup");
}

/** The unauthenticated initial-completion path the signup form uses: not confirmed yet. */
function seedFreshSignup() {
  scenario.adminUsers = {
    [USER_ID]: {
      email: "kaci@test.com",
      email_confirmed_at: null,
      created_at: new Date().toISOString(),
      last_sign_in_at: null,
    } as unknown as { email?: string; email_confirmed_at?: string | null },
  };
  scenario.reads.profiles = { rows: [{ bio: null, full_name: "Kaci Lombas", location: "Delcambre", user_id: USER_ID }] };
  scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }, { user_id: "admin-2" }] };
  scenario.reads.notifications = { rows: [] };
  scenario.writeSelectRows.profiles = [{ user_id: USER_ID }];
}

const signupBody = { userId: USER_ID, location: "Delcambre", zipCode: "70528", ageAttested: true, termsAccepted: true };

describe("complete-signup does not announce a new member; the email confirmation does", () => {
  let capRead: MockInstance<typeof fetch>;
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    capRead = stubSignupCapRead();
  });
  afterEach(() => capRead.mockRestore());

  it("an unconfirmed signup writes NO admin notification; it only asks the confirm-gated writer", async () => {
    seedFreshSignup();
    scenario.rpc.notify_admins_new_member = "not_confirmed";

    const fn = await load();
    const res = await fn.fetch(fn.request({ body: signupBody }));
    expect(res.status).toBe(200);

    // THE BUG: these rows were written here, before the member confirmed.
    expect(scenario.writes.filter((w) => w.table === "notifications")).toEqual([]);
    const calls = (scenario.rpcCalls ?? []).filter((c) => c.name === "notify_admins_new_member");
    expect(calls, "inventory floor: the writer was asked exactly once").toHaveLength(1);
    expect(calls[0].args).toEqual({ p_user_id: USER_ID, p_via: "complete-signup" });
  });

  it("a failed notice check never fails the finished signup, and is logged", async () => {
    seedFreshSignup();
    scenario.rpcErrors = { notify_admins_new_member: { message: "Could not find the function", code: "PGRST202" } };

    const fn = await load();
    const res = await fn.fetch(fn.request({ body: signupBody }));
    expect(res.status).toBe(200);
    expect(scenario.writes.filter((w) => w.table === "notifications")).toEqual([]);
  });
});
