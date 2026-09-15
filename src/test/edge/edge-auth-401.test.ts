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
 * (`create-payment` is the third endpoint in EF-03 but is owned by another
 * branch this run must not touch; its 401 is deferred and noted in the report.)
 *
 * Runs the REAL function source through the edge harness.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";

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
