/**
 * EF-03 (hole hunt 2026-09-15): an AUTH rejection on a money endpoint must
 * return 401/403, never 500.
 *
 * `cash-out-credits` and `helpr-pass-wallet` both `throw` on a missing/invalid
 * Authorization header, which fell through to a generic catch that answered
 * 500. On a money path a 500 reads as "the charge broke" — so every expired
 * session and every bot scan of the public URL booked a false 500, drowning
 * the one signal that says a real charge failed, and told the client to retry
 * when it should re-authenticate.
 *
 * (`create-payment`, the third endpoint in EF-03, was deferred then; Q255
 * closed it together with stripe-connect and pro-customer-portal, and the
 * class check below now walks every function that verifies a JWT.)
 *
 * Runs the REAL function source through the edge harness.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "../helpers/blankNonCode";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";
import { stubSignupCapRead } from "./mocks/signupCapFetch";

function baseEnv() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    PUBLISHABLE_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_x",
  });
}

describe("EF-03 — auth rejection returns 401, not 500", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
  });

  for (const fnName of ["cash-out-credits", "helpr-pass-wallet"]) {
    it(`${fnName}: no Authorization header → 401`, async () => {
      // Before the fix: 500 {"error":"Internal server error" | "..."}.
      baseEnv();
      const fn = await loadEdgeFunction(fnName);
      const res = await fn.fetch(fn.request({ body: {} }));
      expect(res.status).toBe(401);
    });

    it(`${fnName}: a bearer that resolves to no user → 401`, async () => {
      baseEnv();
      scenario.authUser = null;
      const fn = await loadEdgeFunction(fnName);
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: "Bearer nope" }, body: {} }),
      );
      expect(res.status).toBe(401);
    });
  }
});

// ─── Q255: the CLASS — every edge function that verifies a JWT ─────────────
//
// stripe-connect and create-payment answered 500, not 401, to an invalid
// bearer (a thrown error fell to the generic catch), and pro-customer-portal
// did the same (bus EF-010). EF-03 above fixed two functions by name; this
// walks every function whose source calls `auth.getUser`, runs the REAL
// source, and sends it the three auth failures a client can present.
//
// Registered mutations - each turns this guard RED on its own:
// @mutate supabase/functions/stripe-connect/index.ts |     if (authError \|\| !user?.email) {\n      return new Response(JSON.stringify({ error: "Not authenticated" }), { |     if (authError \|\| !user?.email) {\n      throw new Error("Not authenticated");\n      return new Response(JSON.stringify({ error: "Not authenticated" }), {
// @mutate supabase/functions/create-payment/index.ts |     if (!user?.email) {\n      return new Response(JSON.stringify({ error: "Not authenticated" }), { |     if (!user?.email) {\n      throw new PublicError("Not authenticated");\n      return new Response(JSON.stringify({ error: "Not authenticated" }), {
// @mutate supabase/functions/pro-customer-portal/index.ts |     if (!user?.email) return unauthorized(); |     if (!user?.email) throw new Error("User not authenticated");

const FUNCTIONS_DIR = resolve(__dirname, "..", "..", "..", "supabase", "functions");

/**
 * Every secret prod has set. A function that checks a secret BEFORE auth
 * (send-marketing-blast's RESEND_API_KEY, send-account-status-email's
 * CRON_SECRET) answers 500 "not configured" without one — true, but a
 * deployment fault, not the auth answer this guard measures.
 */
function prodLikeEnv() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    PUBLISHABLE_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_x",
    CRON_SECRET: "cron-secret",
    RESEND_API_KEY: "re_test",
    OPENAI_API_KEY: "sk-openai",
    ANTHROPIC_API_KEY: "sk-ant",
  });
}

/** Every function whose own index.ts verifies a user JWT, from source. */
function jwtVerifyingFunctions(): string[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter((d) => !d.startsWith("_"))
    .filter((d) => {
      const entry = join(FUNCTIONS_DIR, d, "index.ts");
      return existsSync(entry) && /\.auth\.getUser\s*\(/.test(blankComments(readFileSync(entry, "utf8")));
    })
    .sort();
}

/**
 * Reviewed functions that do NOT answer 401, with the status they answer and
 * why. Exact both ways: a different status fails, so a change is re-reviewed.
 */
const NOT_401: Record<string, { status: number; why: string }> = {
  "contact-support": {
    status: 400,
    why: "auth is optional by design — a failed getUser makes it a GUEST submission, never a 401; the 400 is the empty form",
  },
  "create-bgc-payment": {
    status: 503,
    why: "BGC_PURCHASE_ENABLED=false kill switch answers everyone 503 before auth (nothing is charged); its auth branch returns 401",
  },
};

describe("Q255 — every JWT-verifying edge function answers an auth failure with 401", () => {
  // complete-signup reads its signup cap with a raw fetch the supabase mock
  // cannot see; answer that one read, pass everything else to the guard.
  let capStub: ReturnType<typeof stubSignupCapRead>;
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
    capStub = stubSignupCapRead();
  });
  afterEach(() => capStub.mockRestore());

  const fns = jwtVerifyingFunctions();

  it("the inventory is read from source and is not empty", () => {
    expect(fns.length).toBeGreaterThan(30);
    expect(fns).toEqual(expect.arrayContaining(["stripe-connect", "create-payment", "pro-customer-portal"]));
    const stale = Object.keys(NOT_401).filter((f) => !fns.includes(f));
    expect(stale, "NOT_401 names a function that no longer verifies a JWT").toEqual([]);
  });

  const cases: Array<{ label: string; setup: () => void; headers: Record<string, string> }> = [
    { label: "an invalid bearer (getUser errors)", setup: () => { scenario.authUser = null; scenario.authError = { message: "invalid JWT" }; }, headers: { Authorization: "Bearer nope" } },
    { label: "a bearer that resolves to no user", setup: () => { scenario.authUser = null; scenario.authError = null; }, headers: { Authorization: "Bearer gone" } },
    { label: "no Authorization header", setup: () => { scenario.authUser = null; scenario.authError = null; }, headers: {} },
  ];

  for (const fnName of fns) {
    for (const c of cases) {
      it(`${fnName}: ${c.label} → ${NOT_401[fnName]?.status ?? 401}`, async () => {
        prodLikeEnv();
        c.setup();
        const fn = await loadEdgeFunction(fnName);
        const res = await fn.fetch(fn.request({ headers: c.headers, body: { action: "get_status" } }));
        expect(res.status).toBe(NOT_401[fnName]?.status ?? 401);
      });
    }
  }
});

// ─── proven able to fail, 2026-09-21 ───────────────────────────────────────
// Remove the early 401 and the missing header falls through to the generic
// catch, which is the pre-fix 500 on a money path. Red:
//   × cash-out-credits: no Authorization header → 401
//   AssertionError: expected 500 to be 401
// The guard asserts a real executed status code, not a source string.
// @mutate supabase/functions/cash-out-credits/index.ts | if (!authHeader) { | if (false) {
