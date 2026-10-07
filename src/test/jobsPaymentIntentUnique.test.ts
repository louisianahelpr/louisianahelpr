/**
 * Q1355 (4) — jobs.stripe_payment_intent_id is unique.
 *
 * Every Stripe webhook finds its job by this column with .maybeSingle()
 * (charge.refunded, charge.refund.updated, charge.dispute.*,
 * payment_intent.succeeded). With no index, two jobs on one PaymentIntent
 * would make each of those lookups error and the webhook throw on every
 * redelivery. Measured live 2026-10-07: no index, 0 shared ids.
 * Behaviour: src/test/pglite/jobsPaymentIntentUnique.pglite.mjs (applied 3x:
 * ALL PASS; NEW_MIGRATION=skip: 2 FAILED).
 *
 * @mutate supabase/migrations/20261007035201_jobs_payment_intent_unique.sql | CREATE UNIQUE INDEX IF NOT EXISTS jobs_stripe_payment_intent_id_unique_idx | CREATE INDEX IF NOT EXISTS jobs_stripe_payment_intent_id_unique_idx
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(process.cwd(), "supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

describe("Q1355 (4): one job per Stripe PaymentIntent", () => {
  it("reads the migrations (floor)", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("a unique partial index on jobs(stripe_payment_intent_id) exists and no later migration drops it", () => {
    let created = -1;
    let dropped = -1;
    files.forEach((f, i) => {
      const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8")).replace(/\s+/g, " ");
      if (/CREATE UNIQUE INDEX (IF NOT EXISTS )?jobs_stripe_payment_intent_id_unique_idx ON public\.jobs \(stripe_payment_intent_id\) WHERE stripe_payment_intent_id IS NOT NULL/i.test(sql)) created = i;
      if (/DROP INDEX (IF EXISTS )?(public\.)?jobs_stripe_payment_intent_id_unique_idx/i.test(sql)) dropped = i;
    });
    expect(created).toBeGreaterThanOrEqual(0);
    expect(dropped).toBeLessThan(created);
  });
});
