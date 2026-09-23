/**
 * Q197 — `complete-signup` refuses a LOCKED-OUT account before any upload.
 *
 * The refusal (then for the `denied` state, retired in Q193) used to run after
 * the avatar / license / insurance uploads, so a refused caller could still
 * put objects into storage on every attempt, bounded only by the signup rate
 * limit (Q40 authz review, Info). The profile read and the lockout check now
 * sit ahead of every upload; a ban is the only lockout left.
 *
 * These execute the real function through the edge harness; the double's
 * bucket is a real key set, so "was anything stored?" is answered by the same
 * upload() the function would make.
 *
 * PROVEN RED 2026-09-23 on the pre-fix function (origin/main 9a0582ecf): the
 * banned case returned 200, stored the avatar + license and approved the row.
 */
//
// Registered mutation - turns this guard RED on its own: dropping the lockout
// refusal. (Moving it back below the uploads is red too: the storage
// assertion fails. The edge double returns whole rows whatever `.select()`
// names, so a narrowed column list is NOT something this file can see.)
// @mutate supabase/functions/complete-signup/index.ts | if (isLockedOut(currentProfile?.ban_status, currentProfile?.auto_suspended_until)) { | if (false) {
import { describe, it, expect, beforeEach, afterEach, type MockInstance } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stubSignupCapRead } from "./mocks/signupCapFetch";

const USER_ID = "33333333-3333-3333-3333-333333333333";
const BYTES = "AAAAAAAA";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return loadEdgeFunction("complete-signup");
}

/** A logged-in account (JWT path) whose profile row carries the given ban. */
function seed(ban: { ban_status: string | null; auto_suspended_until: string | null }) {
  scenario.authUser = { id: USER_ID, email: "locked@test.com" };
  scenario.reads.profiles = {
    rows: [{ bio: null, date_of_birth: null, user_id: USER_ID, ...ban }],
  };
  scenario.writeSelectRows.profiles = [{ user_id: USER_ID }];
}

/** Every file complete-signup would upload. */
const body = {
  location: "Baton Rouge",
  zipCode: "70802",
  parish: "East Baton Rouge",
  ageAttested: true,
  termsAccepted: true,
  avatarBase64: BYTES,
  avatarExt: "png",
  avatarContentType: "image/png",
  licenseBase64: BYTES,
  licenseExt: "pdf",
  licenseContentType: "application/pdf",
  insuranceBase64: BYTES,
  insuranceExt: "pdf",
  insuranceContentType: "application/pdf",
};

const call = async () => {
  const fn = await load();
  return fn.fetch(fn.request({ body, headers: { Authorization: "Bearer user-jwt" } }));
};

describe("Q197: complete-signup refuses a locked-out account before any upload", () => {
  let capRead: MockInstance<typeof fetch>;
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    capRead = stubSignupCapRead();
  });
  afterEach(() => capRead.mockRestore());

  it.each([
    ["banned", null],
    ["permanently_banned", null],
    ["temp_banned", new Date(Date.now() + 86_400_000).toISOString()],
  ])("a %s account sending avatar + license + insurance stores nothing and is not approved", async (status, until) => {
    seed({ ban_status: status, auto_suspended_until: until });
    const res = await call();
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("account_locked");
    expect([...scenario.storage.objects]).toEqual([]);
    expect(scenario.writes.some((w) => w.table === "profiles" && w.op === "update")).toBe(false);
  });

  it("the same call from an active account uploads and records the signup (the refusal is not vacuous)", async () => {
    seed({ ban_status: "active", auto_suspended_until: null });
    const res = await call();
    expect(res.status).toBe(200);
    // All three files were stored, so the harness really exercises uploads.
    expect(scenario.storage.objects.size).toBe(3);
    const update = scenario.writes.find((w) => w.table === "profiles" && w.op === "update");
    // The signup UPDATE ran (terms consent is written on every call), and it
    // no longer writes the retired approval_status (Q205b).
    expect((update?.payload as Record<string, unknown>)?.terms_version_accepted).toBeTruthy();
    expect(update?.payload).not.toHaveProperty("approval_status");
  });

  it("a temp ban that has already lapsed is not a lockout (same definition as ProtectedRoute)", async () => {
    seed({ ban_status: "temp_banned", auto_suspended_until: new Date(Date.now() - 86_400_000).toISOString() });
    const res = await call();
    expect(res.status).toBe(200);
  });
});
