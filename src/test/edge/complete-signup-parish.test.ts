/**
 * `complete-signup` must resolve the member's PARISH itself, from the ZIP.
 *
 * THE BUG THESE TESTS PREVENT (verified against prod 2026-09-06). Signup asks
 * for a ZIP, and `Signup.tsx` resolves the parish from it before calling this
 * function — via `lookupParishByZip()`, which calls the `get_parish_for_zip`
 * RPC. That RPC's ACL is `{postgres=X, service_role=X, authenticated=X}`; anon
 * has no EXECUTE. The entire signup form runs BEFORE the account exists, so
 * every one of those calls came back
 *
 *     401  {"code":"42501","message":"permission denied for function get_parish_for_zip"}
 *
 * `lookupParishByZip` reports that as a warning and returns null, and this
 * function then skipped the column because the client "didn't send one". The
 * profile created through the real /signup UI on 2026-09-05 23:59 carries
 * `zip_code = '70802'` and `parish = NULL` on the same row — a ZIP the database
 * maps to 'East Baton Rouge' the instant a role with the grant asks it.
 *
 * That matters because parish is the fallback the whole radius ladder rests on:
 * `notify_saved_searches_on_new_job` matches on coordinates when both sides
 * have them and on `p.parish = NEW.parish` when they do not — and profiles have
 * no coordinates at all, so parish IS the match. A NULL parish means a helper
 * with a radius saved search matches nothing, forever, silently.
 *
 * A companion migration grants anon EXECUTE so the form's live City/ZIP
 * mismatch hint works again, but the durable fix is the one under test here:
 * this function holds the service-role key, so ITS lookup cannot be denied, and
 * the column no longer depends on the client having succeeded.
 *
 * These tests execute the real function through the edge harness — the mock
 * only stands in for Supabase itself, so the branching is the shipped code.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const USER_ID = "11111111-1111-1111-1111-111111111111";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return loadEdgeFunction("complete-signup");
}

/**
 * The unauthenticated initial-completion path — exactly what the signup form
 * uses. Fresh auth user inside the 30-minute window, never signed in, with an
 * empty profile row waiting.
 */
function seedFreshSignup() {
  // The mock hands `getUserById` this object back verbatim, so the extra keys
  // reach the function even though the scenario type only declares two of
  // them — `created_at` and `last_sign_in_at` are what the 30-minute window
  // and the never-signed-in guard read. Cast rather than widen the shared
  // mock's type, which other lanes' tests depend on.
  scenario.adminUsers = {
    [USER_ID]: {
      email: "new@test.com",
      email_confirmed_at: null,
      created_at: new Date().toISOString(),
      last_sign_in_at: null,
    } as unknown as { email?: string; email_confirmed_at?: string | null },
  };
  // The mock resolves reads by TABLE name, so this row answers every
  // `from("profiles").select(...)` in the function — the empty-profile guard
  // early on and the notification lookup near the end alike.
  scenario.reads.profiles = {
    rows: [
      {
        bio: null,
        approval_status: "pending",
        full_name: "Dana R",
        location: "Baton Rouge",
        user_id: USER_ID,
      },
    ],
  };
  // The zero-row guard on the profile UPDATE is a real gate — give it a row.
  scenario.writeSelectRows.profiles = [{ user_id: USER_ID }];
}

/** The profile UPDATE this function makes, or undefined if it never made one. */
function profileUpdate(): Record<string, unknown> | undefined {
  const w = scenario.writes.find((x) => x.table === "profiles" && x.op === "update");
  return w?.payload as Record<string, unknown> | undefined;
}

/** The body the signup form sends for a Baton Rouge account. */
function signupBody(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER_ID,
    location: "Baton Rouge",
    zipCode: "70802",
    // THE POINT: the client sends no parish, because its own lookup was denied.
    parish: null,
    phone: "(225) 555-0142",
    ageAttested: true,
    termsAccepted: true,
    ...overrides,
  };
}

describe("complete-signup parish derivation", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("resolves parish from the ZIP when the client could not", async () => {
    seedFreshSignup();
    scenario.rpc.get_parish_for_zip = "East Baton Rouge";

    const fn = await load();
    const res = await fn.fetch(fn.request({ body: signupBody() }));
    expect(res.status).toBe(200);

    // The lookup must have actually happened, with the digits-only ZIP.
    const call = scenario.rpcCalls?.find((c) => c.name === "get_parish_for_zip");
    expect(call).toBeDefined();
    expect(call?.args).toEqual({ p_zip: "70802" });

    // And the resolved value must reach the row. This is the assertion the
    // shipped code failed: it wrote zip_code and dropped parish.
    const update = profileUpdate();
    expect(update?.zip_code).toBe("70802");
    expect(update?.parish).toBe("East Baton Rouge");
  });

  it("prefers a parish the client DID resolve, without a second lookup", async () => {
    // Post-auth callers (CompleteProfile runs as `authenticated`, which has the
    // grant) still resolve it themselves. Their answer is already correct, so
    // re-deriving it would be a wasted round-trip on the signup hot path.
    seedFreshSignup();
    scenario.rpc.get_parish_for_zip = "East Baton Rouge";

    const fn = await load();
    const res = await fn.fetch(
      fn.request({ body: signupBody({ parish: "Orleans", zipCode: "70112" }) }),
    );
    expect(res.status).toBe(200);

    expect(scenario.rpcCalls?.some((c) => c.name === "get_parish_for_zip")).toBe(false);
    expect(profileUpdate()?.parish).toBe("Orleans");
  });

  it("still completes the signup when the parish lookup fails", async () => {
    // Non-negotiable: parish is a deferred convenience field. A ZIP outside the
    // reference table, or a transient RPC failure, must degrade to "no parish
    // yet" — never to a rejected signup that leaves an orphaned auth row with
    // no completable profile.
    seedFreshSignup();
    scenario.rpcErrors = {
      get_parish_for_zip: { message: "boom", code: "XX000" },
    };

    const fn = await load();
    const res = await fn.fetch(fn.request({ body: signupBody() }));

    expect(res.status).toBe(200);
    const update = profileUpdate();
    expect(update?.zip_code).toBe("70802");
    // Absent, not null — the function omits keys it has no value for, and
    // writing an explicit null would stomp a parish a later path had set.
    expect(update).not.toHaveProperty("parish");
    // approval_status still went through, i.e. the account is actually usable.
    expect(update?.approval_status).toBe("approved");
  });

  it("does not attempt a lookup for a ZIP that cannot be one", async () => {
    // A 4-digit or empty ZIP is not a Louisiana ZIP; asking the database is a
    // round-trip that can only return null.
    seedFreshSignup();
    scenario.rpc.get_parish_for_zip = "East Baton Rouge";

    const fn = await load();
    const res = await fn.fetch(fn.request({ body: signupBody({ zipCode: "708" }) }));

    expect(res.status).toBe(200);
    expect(scenario.rpcCalls?.some((c) => c.name === "get_parish_for_zip")).toBe(false);
    expect(profileUpdate()).not.toHaveProperty("parish");
  });
});
