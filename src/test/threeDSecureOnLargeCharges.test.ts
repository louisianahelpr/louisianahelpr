/**
 * 3D Secure on card charges of $300 and up (docs/OPEN.md Q202, owner decision
 * 2026-09-23: "request_three_d_secure 'any' on those PaymentIntents/Checkout
 * sessions; make sure the client flow handles requires_action on web AND
 * native").
 *
 * Before: no charge anywhere requested 3DS, so a "fraudulent / not authorized"
 * card dispute always landed on the platform.
 *
 * What holds it now:
 *   1. the rule itself (_shared/threeDSecure.ts): >= 30000 cents → 'any';
 *   2. INVENTORY: every `checkout.sessions.create(` under supabase/functions is
 *      either passed through threeDSecureOptions(...) or listed in EXEMPT with
 *      a price ceiling this test PROVES is below $300. A new checkout that
 *      skips it fails here by file and count;
 *   3. behaviour on the REAL create-payment through the edge harness: a $400
 *      job's Checkout Session carries request_three_d_secure 'any', a $100 one
 *      does not;
 *   4. requires_action: the challenge runs on Stripe's HOSTED Checkout page
 *      (web: a navigation; native: the in-app browser sheet opened by
 *      openExternalUrl), so no client code may confirm a PaymentIntent itself;
 *      and a poster who walked away from a challenge (session still open, PI
 *      `requires_action`) can "Finish paying" again instead of being told the
 *      payment is "still being processed" for 24h.
 *
 * @mutate supabase/functions/_shared/threeDSecure.ts | export const THREE_D_SECURE_MIN_CENTS = 30000; | export const THREE_D_SECURE_MIN_CENTS = 3000000;
 * @mutate supabase/functions/create-payment/index.ts | // (tax is only known once Checkout has the address; it can only add).\n        payment_method_options: threeDSecureOptions( | // (tax is only known once Checkout has the address; it can only add).\n        payment_method_options_unused: threeDSecureOptions(
 * @mutate supabase/functions/create-gift-card-checkout/index.ts | payment_method_options: threeDSecureOptions(chargeCents), | payment_method_options: undefined,
 * @mutate supabase/functions/create-payment/index.ts | const abandonedChallenge = prior.status === "open" && priorPi?.status === "requires_action"; | const abandonedChallenge = false;
 * @mutate supabase/functions/create-payment/index.ts |               await stripe.paymentIntents.cancel(priorPi.id); |               void priorPi;
 */
import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { THREE_D_SECURE_MIN_CENTS, threeDSecureOptions } from "../../supabase/functions/_shared/threeDSecure";
import { BOOST_FEE_CENTS, BGC_FEE_CENTS } from "../../supabase/functions/_shared/productPrices";
import { PRO_RECURRING_AMOUNT_CENTS } from "../../supabase/functions/_shared/proTiers";
import { ONBOARDING_FEE_CENTS } from "@/lib/moneyLimits";
import { blankComments } from "./helpers/blankNonCode";
import { loadEdgeFunction } from "./edge/harness";
import { setEnv, resetEnv } from "./edge/mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./edge/mocks/stripe";
import { scenario, resetSupabaseMock } from "./edge/mocks/supabase";
import { resetSharedMocks } from "./edge/mocks/shared";

const ROOT = resolve(__dirname, "../..");
const FN_DIR = join(ROOT, "supabase/functions");

/** Checkout sessions that may skip 3DS, each with the most it can ever charge. */
// @two-way src/test/threeDSecureOnLargeCharges.test.ts:const staleExempt =
const EXEMPT: Record<string, { maxCents: number; why: string }> = {
  "create-boost-payment": { maxCents: BOOST_FEE_CENTS, why: "fixed $3 boost" },
  "create-bgc-payment": { maxCents: BGC_FEE_CENTS, why: "fixed $34.99 background check" },
  "create-pro-checkout": {
    maxCents: Math.max(...Object.values(PRO_RECURRING_AMOUNT_CENTS).flatMap((t) => Object.values(t))),
    why: "membership prices, largest is the annual top tier",
  },
  "pay-onboarding-fee": { maxCents: ONBOARDING_FEE_CENTS, why: "one-time $2 onboarding fee" },
};

function functionSources(): Array<{ fn: string; src: string }> {
  return readdirSync(FN_DIR)
    .filter((d) => !d.startsWith("_") && statSync(join(FN_DIR, d)).isDirectory())
    .flatMap((d) => {
      try {
        return [{ fn: d, src: blankComments(readFileSync(join(FN_DIR, d, "index.ts"), "utf8")) }];
      } catch {
        return [];
      }
    });
}

/** The argument text of each `checkout.sessions.create(` call (balanced parens). */
function createCalls(src: string): string[] {
  const out: string[] = [];
  const needle = "checkout.sessions.create(";
  let i = src.indexOf(needle);
  while (i >= 0) {
    let depth = 0;
    let j = i + needle.length - 1;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) break;
    }
    out.push(src.slice(i, j + 1));
    i = src.indexOf(needle, j);
  }
  return out;
}

describe("3D Secure on large card charges (Q202)", () => {
  it("requests 3DS from $300 up and not below", () => {
    expect(THREE_D_SECURE_MIN_CENTS).toBe(30000);
    expect(threeDSecureOptions(29999)).toBeUndefined();
    expect(threeDSecureOptions(30000)).toEqual({ card: { request_three_d_secure: "any" } });
    expect(threeDSecureOptions(100000)).toEqual({ card: { request_three_d_secure: "any" } });
    expect(threeDSecureOptions(Number.NaN)).toBeUndefined();
  });

  it("every Checkout Session goes through threeDSecureOptions, or is exempt with a proven sub-$300 ceiling", () => {
    const missing: string[] = [];
    const exemptUsed = new Set<string>();
    let total = 0;
    let covered = 0;
    for (const { fn, src } of functionSources()) {
      for (const call of createCalls(src)) {
        total++;
        if (/payment_method_options:\s*threeDSecureOptions\(/.test(call)) {
          covered++;
          continue;
        }
        const ex = EXEMPT[fn];
        if (ex) exemptUsed.add(fn);
        else missing.push(`${fn}: ${call.slice(0, 80).replace(/\s+/g, " ")}…`);
      }
    }
    // Two-way: an exemption for a function that no longer has an un-3DS'd checkout is stale.
    const staleExempt = Object.keys(EXEMPT).filter((fn) => !exemptUsed.has(fn));
    expect(staleExempt, "stale EXEMPT entry — remove it").toEqual([]);
    expect(missing, `Checkout Sessions with no 3DS rule:\n  ${missing.join("\n  ")}`).toEqual([]);
    // Inventory floors: 3 in create-payment (escrow, gift shortfall, tip) + gift cards.
    expect(total).toBeGreaterThan(7);
    expect(covered).toBeGreaterThanOrEqual(4);
    for (const [fn, ex] of Object.entries(EXEMPT)) {
      expect(ex.maxCents, `${fn} (${ex.why}) can charge $300+, so it needs 3DS`).toBeLessThan(THREE_D_SECURE_MIN_CENTS);
    }
  });

  it("no client code confirms a PaymentIntent itself: requires_action is handled by hosted Checkout on web and native", () => {
    // From git, not a directory walk: other tests write and delete temporary
    // fixtures under src/test while this runs (CI 2026-09-23: ENOENT on a
    // q136Control-*.ts that existed for milliseconds). Tracked files only, and
    // one deleted in the working tree is skipped.
    const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
      .trim().split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))
      .map((f) => join(ROOT, f))
      .filter((f) => existsSync(f));
    expect(files.length).toBeGreaterThan(200);
    const offenders = files.filter((f) =>
      /@stripe\/stripe-js|\.confirmCardPayment\(|\.handleNextAction\(|\.handleCardAction\(|stripe\.confirmPayment\(/.test(
        blankComments(readFileSync(f, "utf8")),
      ),
    );
    expect(offenders).toEqual([]);
    // The money hand-off opens Stripe in the in-app browser sheet on native.
    const opener = readFileSync(join(ROOT, "src/lib/openExternalUrl.ts"), "utf8");
    expect(opener).toMatch(/Browser\.open\(/);
  });
});

describe("create-payment escrow checkout — behaviour (edge harness)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  async function escrowFor(budget: number, prior?: { status: string; piStatus: string }) {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_abc123",
    });
    const fn = await loadEdgeFunction("create-payment");
    scenario.authUser = { id: "poster-1", email: "poster@test.com" };
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
    scenario.reads.jobs = {
      rows: [{
        id: "job-1", customer_id: "poster-1", budget, category: "cleaning", title: "Clean my house",
        payment_status: prior ? "failed" : "unpaid", stripe_session_id: prior ? "cs_old" : null,
      }],
    };
    scenario.reads.platform_settings = { rows: [{ customer_fee_percent: 10, helper_fee_percent: 10, onboarding_fee_cents: 200 }] };
    scenario.reads.profiles = { rows: [{ onboarding_fee_paid: true, subscription_tier: "pro" }] };
    if (prior) {
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({
        id: "cs_old", status: prior.status, payment_status: "unpaid",
        payment_intent: { id: "pi_old", status: prior.piStatus },
      });
    }
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_new", url: "https://checkout.stripe.test/cs_new" });
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer test-jwt" }, body: { action: "escrow", jobId: "job-1" } }));
    return { res, body: JSON.parse(await res.text()) as Record<string, unknown> };
  }

  it("a $400 job's Checkout Session requests 3D Secure", async () => {
    await escrowFor(400);
    const params = stripeMock.checkout.sessions.create.mock.calls[0][0];
    expect(params.payment_method_options).toEqual({ card: { request_three_d_secure: "any" } });
  });

  it("a $100 job's Checkout Session does not", async () => {
    await escrowFor(100);
    const params = stripeMock.checkout.sessions.create.mock.calls[0][0];
    expect(params.payment_method_options).toBeUndefined();
  });

  it("a job over the $1,000 cap is refused before any checkout exists", async () => {
    const { body } = await escrowFor(1500);
    expect(String(body.error)).toMatch(/\$10 to \$1,000/);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("an abandoned 3DS challenge (open session, PI requires_action) can be paid again, and its PI is canceled", async () => {
    const { body } = await escrowFor(400, { status: "open", piStatus: "requires_action" });
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_old");
    expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_old");
    expect(body.url).toBe("https://checkout.stripe.test/cs_new");
  });

  it("a challenge completed meanwhile (the PI can no longer be canceled) is refused, never re-minted", async () => {
    stripeMock.paymentIntents.cancel.mockRejectedValue(new Error("This PaymentIntent's status is succeeded"));
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_old", status: "succeeded" });
    const { body } = await escrowFor(400, { status: "open", piStatus: "requires_action" });
    expect(String(body.error)).toMatch(/still being processed/i);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a PI that is actually processing is still refused", async () => {
    const { body } = await escrowFor(400, { status: "open", piStatus: "processing" });
    expect(String(body.error)).toMatch(/still being processed/i);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });
});
