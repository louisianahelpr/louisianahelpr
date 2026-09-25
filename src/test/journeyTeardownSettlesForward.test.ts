/**
 * THE TEARDOWN HAS TO READ THE ANSWER.
 *
 * `02-marketplace.spec.ts` is a `describe.serial` chain that funds a real
 * (test-mode) escrow in J4. When a run died after that, its `afterAll` sent the
 * job to `create-payment { action: "cancel_escrow" }` — which CORRECTLY refuses
 * it, 409 `useCancelJob`, because that door is an allowlist of `status = 'open'`
 * with no `helper_id` and a hired job has a cancellation-fee ladder a direct
 * refund would skip. The call was fire-and-forget, so the refusal was invisible.
 *
 * Measured on prod 2026-09-22: SIXTEEN such rows sitting in escrow on the
 * shared poster-e2e / helper-e2e pair, the oldest created 2026-09-15 — and not
 * one of them had a `helper_completed_at`, so `auto-release-payment` was never
 * going to see them either. Every nightly log said the job had been unwound.
 *
 * Owner standing order: an owner-reported bug ships with a CI check for its
 * whole CLASS, built from the app's own inventory. The class here is "a
 * teardown call whose response nobody looks at", so this reads the teardown's
 * own source and requires EVERY unwind call in it to be bound and tested —
 * rather than pinning the one line that was wrong.
 *
 * It also pins the disposition, because the naive fix is worse than the bug:
 * `poster_cancel_job` on a job a Helpr accepted records a `cancel_with_helper`
 * STRIKE against poster-e2e, and three of those restrict the account for 7 days
 * and break every nightly journey that signs in as it. So the funded-and-hired
 * branch must settle the job FORWARD and must never reach for that RPC.
 *
 * The mutation restores the original defect exactly: the branch that reads the
 * cancel_escrow answer is switched off, and the refusal goes back to being
 * silent.
 *
 * @mutate e2e/journeys/02-marketplace.spec.ts | if (!cancelled.ok()) { | if (false) {
 * @mutate scripts/e2e/settleForward.mjs | if (typeof job?.title === "string" && job.title.includes(E2E_HOLD_MARKER)) return | if (false) return
 * @mutate scripts/e2e/settleForward.mjs | !job.stripe_session_id.startsWith("cs_test_") | !job.stripe_session_id.startsWith("cs_")
 * @mutate scripts/e2e/settleForward.mjs | if (lifecycleId && job?.id === lifecycleId) return | if (false) return
 * @mutate scripts/e2e/settleForward.mjs |   if (job.stripe_session_id == null) return NO_CHECKOUT_SESSION;\n |
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isSettleForwardRefusal, settleRefusalReason, heldReason, NO_CHECKOUT_SESSION } from "../../scripts/e2e/settleForward.mjs";

const SPEC = resolve(process.cwd(), "e2e/journeys/02-marketplace.spec.ts");
const source = readFileSync(SPEC, "utf8");

/** The `test.afterAll(...)` body, sliced off at the first journey that follows it. */
function teardownBody(src: string): string {
  const start = src.indexOf("test.afterAll(");
  expect(start, "02-marketplace.spec.ts no longer has a test.afterAll").toBeGreaterThan(-1);
  const end = src.indexOf('const j2 = title("post"', start);
  expect(end, "could not find the end of the afterAll block").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("02-marketplace teardown", () => {
  const body = teardownBody(source);

  it("binds and checks the response of every unwind call it makes", () => {
    /* The inventory is the teardown's own calls, not a list typed here: any
       new unwind door added later is covered the day it is added. */
    const calls = [...body.matchAll(/(?:^|\n)\s*(?:(const|let)\s+(\w+)\s*=\s*)?await\s+(request\.post|request\.patch)\(/g)];
    expect(calls.length, "the teardown makes no requests at all any more").toBeGreaterThan(0);

    const unchecked: string[] = [];
    for (const call of calls) {
      const binding = call[2];
      if (!binding) {
        unchecked.push(`${call[3]} whose response is never bound to a variable`);
        continue;
      }
      // `.ok()` is Playwright's status test; `.status()` alone is not a check.
      if (!new RegExp(`\\b${binding}\\.ok\\(\\)`).test(body)) {
        unchecked.push(`${binding} is bound but its .ok() is never read`);
      }
    }
    expect(
      unchecked,
      "a teardown call whose answer nobody reads is how 16 rows sat in escrow for a week",
    ).toEqual([]);
  });

  it("settles a hired, funded leftover FORWARD and never cancels it", () => {
    // The 409 that means "hired and funded" is recognised…
    expect(body).toMatch(/isSettleForwardRefusal\(/);
    // …and answered by settling forward, not by cancelling.
    expect(body).toMatch(/settleJobForward\(/);

    /* The poster_cancel_job CALL (not the prose about why it is wrong) may sit
       ONLY on the unfunded branch. A cancel on a job with a Helpr on it is the
       strike that restricts poster-e2e for 7 days. */
    const cancelRpc = body.indexOf("rpc/poster_cancel_job");
    expect(cancelRpc, "the teardown no longer cancels unfunded leftovers at all").toBeGreaterThan(-1);
    const fundedBranch = body.indexOf('job.payment_status !== "unpaid"');
    expect(fundedBranch).toBeGreaterThan(-1);
    const unfundedBranch = body.lastIndexOf("} else {", cancelRpc);
    expect(
      unfundedBranch,
      "poster_cancel_job moved out of the unfunded branch — on a hired job it records a cancel_with_helper strike",
    ).toBeGreaterThan(fundedBranch);
    // And the settle-forward disposition belongs to the FUNDED branch above it.
    expect(body.indexOf("settleJobForward(")).toBeLessThan(unfundedBranch);
  });

  it("reports, rather than swallows, a refusal it cannot settle", () => {
    expect(body).toMatch(/announceUncovered\(/);
  });
});

describe("isSettleForwardRefusal", () => {
  it("is the 409 that carries useCancelJob and nothing else", () => {
    expect(isSettleForwardRefusal(409, '{"error":"…","useCancelJob":true}')).toBe(true);
    // A dispute 409 is a DIFFERENT refusal: that escrow is an admin's to place.
    expect(isSettleForwardRefusal(409, '{"error":"This job is under dispute…"}')).toBe(false);
    expect(isSettleForwardRefusal(429, '{"error":"Too many requests."}')).toBe(false);
    expect(isSettleForwardRefusal(200, "")).toBe(false);
  });
});

describe("settleRefusalReason", () => {
  const seats = { posterId: "poster-uuid", helperId: "helper-uuid" };
  const hiredAndFunded = {
    is_seed: true,
    customer_id: "poster-uuid",
    helper_id: "helper-uuid",
    payment_status: "escrow",
    status: "accepted",
    disputed_at: null,
    has_active_dispute: false,
    title: "[E2E DO NOT ACCEPT] J 1",
    stripe_session_id: "cs_test_a1B2c3",
  };

  it("admits a hired, funded, seeded leftover on the calling pair", () => {
    expect(settleRefusalReason(hiredAndFunded, seats)).toBeNull();
  });

  it("refuses anything that is not a seed row", () => {
    expect(settleRefusalReason({ ...hiredAndFunded, is_seed: false }, seats)).toMatch(/is_seed/);
  });

  it("refuses a row belonging to anyone but the calling pair", () => {
    expect(settleRefusalReason({ ...hiredAndFunded, customer_id: "someone-else" }, seats)).toMatch(/poster/);
    expect(settleRefusalReason({ ...hiredAndFunded, helper_id: "someone-else" }, seats)).toMatch(/helper/);
  });

  it("refuses a disputed job — that escrow is an admin's to place", () => {
    expect(settleRefusalReason({ ...hiredAndFunded, disputed_at: "2026-09-19T14:12:12Z" }, seats)).toMatch(/dispute/);
    expect(settleRefusalReason({ ...hiredAndFunded, has_active_dispute: true }, seats)).toMatch(/dispute/);
  });

  it("refuses a row held on purpose (review M3)", () => {
    expect(settleRefusalReason({ ...hiredAndFunded, title: "[E2E DO NOT ACCEPT] [E2E HOLD] two-role" }, seats)).toMatch(/held on purpose/);
  });

  it("refuses a row not funded through a test-mode Checkout Session (review L2)", () => {
    expect(settleRefusalReason({ ...hiredAndFunded, stripe_session_id: "cs_live_a1B2c3" }, seats)).toMatch(/test-mode/);
  });

  it("refuses a funded row with NO Checkout Session (gift card) as its own reason, not as a mode failure", () => {
    expect(settleRefusalReason({ ...hiredAndFunded, stripe_session_id: null }, seats)).toBe(NO_CHECKOUT_SESSION);
    expect(settleRefusalReason({ ...hiredAndFunded, stripe_session_id: undefined }, seats)).toBe(NO_CHECKOUT_SESSION);
  });

  it("holds the two-role fixture BY ID, whatever its title (re-review of 5a22b3e10)", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const env = { PLAYWRIGHT_LIFECYCLE_JOB_ID: id };
    expect(heldReason({ id, title: "[E2E DO NOT ACCEPT] no hold marker" }, env)).toMatch(/PLAYWRIGHT_LIFECYCLE_JOB_ID/);
    expect(heldReason({ id: "other", title: "[E2E DO NOT ACCEPT] x" }, env)).toBeNull();
    // Unset or blank holds nothing extra.
    expect(heldReason({ id, title: "[E2E DO NOT ACCEPT] x" }, {})).toBeNull();
    expect(heldReason({ id: "", title: "x" }, { PLAYWRIGHT_LIFECYCLE_JOB_ID: "  " })).toBeNull();
    const prev = process.env.PLAYWRIGHT_LIFECYCLE_JOB_ID;
    process.env.PLAYWRIGHT_LIFECYCLE_JOB_ID = id;
    try {
      expect(settleRefusalReason({ ...hiredAndFunded, id }, seats)).toMatch(/held on purpose/);
    } finally {
      if (prev === undefined) delete process.env.PLAYWRIGHT_LIFECYCLE_JOB_ID;
      else process.env.PLAYWRIGHT_LIFECYCLE_JOB_ID = prev;
    }
  });

  it("treats an already-settled row as nothing to do, not as an error", () => {
    expect(settleRefusalReason({ ...hiredAndFunded, payment_status: "payout_pending" }, seats)).toBe("already settled");
    expect(settleRefusalReason({ ...hiredAndFunded, payment_status: "released" }, seats)).toBe("already settled");
  });
});
