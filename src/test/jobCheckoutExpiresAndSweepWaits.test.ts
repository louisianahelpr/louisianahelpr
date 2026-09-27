/**
 * Q770 + Q771 class check: a job checkout is bounded in time, and nothing
 * gives up on it while Stripe still has it open.
 *
 * Q770: every Checkout Session whose id is stamped onto the job
 * (create-payment's stampSession) carries a short `expires_at`. Without one
 * the session lived Stripe's default 24h, and the declined-card notice, which
 * waits for checkout.session.expired (Q769), could arrive a day late. The
 * expiry comes from a 10-minute bucket that is also in the idempotency key,
 * or a double-tap would send changed params under one key.
 *
 * Q771: void-cancelled-payments' abandoned-checkout sweep abandons a job only
 * when Stripe says its session EXPIRED. payment_status is 'unpaid' on an open
 * session too, so keying on it abandoned a poster mid-checkout.
 *
 * Class, derived from the tree: every checkout.sessions.create under
 * supabase/functions is found; those followed by stampSession( are the job
 * checkouts.
 *
 * Gift gate (review of Q770): two taps either side of a key bucket open two
 * sessions for one gift reservation. checkoutSessionExpired frees the gift
 * only when the expiring session is not superseded by another on the job.
 *
 * @mutate supabase/functions/create-payment/index.ts | expires_at: checkoutExpiresAt,\n        metadata: { job_id: jobId, customer_id: user.id, onboarding | metadata: { job_id: jobId, customer_id: user.id, onboarding
 * @mutate supabase/functions/create-payment/index.ts | expires_at: checkoutExpiresAt,\n          metadata: { job_id: jobId, customer_id: user.id, gift_card_id | metadata: { job_id: jobId, customer_id: user.id, gift_card_id
 * @mutate supabase/functions/create-payment/index.ts | idempotencyKey: `escrow-${jobId}${checkoutKeySuffix}` | idempotencyKey: `escrow-${jobId}${remintKeySuffix}`
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (session.status === "expired" && session.payment_status === "unpaid") { | if (session.payment_status === "unpaid") {
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionExpired.ts | const superseded = !!job?.stripe_session_id && job.stripe_session_id !== session.id; | const superseded = false;
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const FN_ROOT = "supabase/functions";
const read = (p: string) => readFileSync(p, "utf8");
const CREATE = "checkout.sessions.create(";

function jobCheckouts() {
  const out: { file: string; block: string }[] = [];
  for (const dir of readdirSync(FN_ROOT)) {
    const file = join(FN_ROOT, dir, "index.ts");
    if (!existsSync(file)) continue;
    const src = read(file);
    const starts: number[] = [];
    for (let i = src.indexOf(CREATE); i !== -1; i = src.indexOf(CREATE, i + 1)) starts.push(i);
    starts.forEach((start, k) => {
      const end = starts[k + 1] ?? src.length;
      const span = src.slice(start, end);
      const stamp = span.indexOf("stampSession(");
      if (stamp !== -1) out.push({ file, block: span.slice(0, stamp) });
    });
  }
  return out;
}

describe("Q770: job checkouts carry a short, idempotency-safe expires_at", () => {
  const found = jobCheckouts();

  it("finds the job checkouts (escrow + gift-card shortfall)", () => {
    expect(found.length).toBe(2);
  });

  it.each(found.map((f, i) => [i, f] as const))("job checkout #%i sets expires_at and keys on its bucket", (_i, f) => {
    expect(f.block).toMatch(/expires_at:\s*checkoutExpiresAt/);
    expect(f.block).toMatch(/idempotencyKey:\s*`[^`]*\$\{checkoutKeySuffix\}`/);
  });

  it("the expiry is bucketed and inside Stripe's 30 min..24h window", () => {
    const src = read(join(FN_ROOT, "create-payment/index.ts"));
    expect(src).toMatch(/checkoutBucketSec = Math\.floor\(Date\.now\(\) \/ 1000 \/ 600\) \* 600/);
    const m = /checkoutExpiresAt = checkoutBucketSec \+ (\d+) \* 60;/.exec(src);
    expect(m).not.toBeNull();
    const minutes = Number(m![1]);
    // bucket + N min is (N-10)..N min from now; Stripe needs >= 30 min.
    expect(minutes - 10).toBeGreaterThanOrEqual(30);
    expect(minutes).toBeLessThanOrEqual(24 * 60);
    expect(src).toMatch(/checkoutKeySuffix = `\$\{remintKeySuffix\}-b\$\{checkoutBucketSec\}`/);
  });
});

describe("Q771: the abandoned-checkout sweep waits for Stripe to expire the session", () => {
  it("abandons on a retrieved session only when its status is expired", () => {
    const src = read(join(FN_ROOT, "void-cancelled-payments/index.ts"));
    const call = src.indexOf('markAbandoned(job, "unpaid")');
    expect(call).toBeGreaterThan(-1);
    const retrieve = src.lastIndexOf("checkout.sessions.retrieve(", call);
    expect(retrieve).toBeGreaterThan(-1);
    const gate = src.slice(retrieve, call);
    expect(gate).toMatch(/session\.status === "expired"/);
  });
});

describe("Gift gate: an orphan session's expiry never frees a gift the live session holds", () => {
  it("checks the job's session before un-reserving the gift", () => {
    const src = read(join(FN_ROOT, "stripe-webhook/handlers/checkoutSessionExpired.ts"));
    const gift = src.indexOf("const giftCardId = meta?.gift_card_id;");
    const free = src.indexOf('.update({ status: "sent", job_id: null })');
    expect(gift).toBeGreaterThan(-1);
    expect(free).toBeGreaterThan(gift);
    const gate = src.slice(gift, free);
    expect(gate).toMatch(/const superseded = !!job\?\.stripe_session_id && job\.stripe_session_id !== session\.id;/);
    expect(gate).toMatch(/if \(superseded \|\| funded\) \{[\s\S]*?return;/);
  });
});
