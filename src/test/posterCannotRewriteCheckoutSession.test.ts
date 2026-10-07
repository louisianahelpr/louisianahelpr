/**
 * Q1366 — a poster cannot rewrite jobs.stripe_session_id on their own job.
 *
 * Measured live 2026-10-06: has_column_privilege('authenticated','public.jobs',
 * 'stripe_session_id','UPDATE') = true, and enforce_poster_jobs_money_lock
 * named the column in none of its lists, so a poster could point the job at
 * another Checkout Session (void-cancelled-payments resolves the PaymentIntent
 * from it when a cancelled escrow job has none) or clear an open one (the money
 * lock and EditJobDialog read a non-null session as "checkout opened").
 * Only the service role writes it (create-payment stampSession, stripe-webhook
 * checkoutSessionExpired), which is_server_context() passes.
 *
 * Pinned on the definition the database holds (newest migration); behaviour,
 * red then green: src/test/pglite/posterCannotRewriteCheckoutSession.pglite.mjs
 * (applied 3x: ALL PASS; NEW_MIGRATION=skip: 3 FAILED).
 *
 * @mutate supabase/migrations/20261007032429_poster_cannot_rewrite_checkout_session.sql |     'stripe_session_id'\n  ]; |     'created_at_x'\n  ];
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));

function arrayCols(body: string, name: string): string[] {
  const m = new RegExp(`${name}\\s+CONSTANT\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\];`, "i").exec(body);
  return [...(m?.[1] ?? "").matchAll(/'(\w+)'/g)].map((x) => x[1]);
}

describe("Q1366: jobs.stripe_session_id is locked against the poster", () => {
  const lock = blankSqlComments(defs.get("enforce_poster_jobs_money_lock")?.stmt ?? "");
  const always = arrayCols(lock, "locked_always");

  it("the parse sees the lock's always-locked list", () => {
    expect(always.length).toBeGreaterThan(10);
    expect(always).toContain("stripe_payment_intent_id");
  });

  it("stripe_session_id is in locked_always (every job state, not only once funded)", () => {
    expect(always).toContain("stripe_session_id");
  });
});
