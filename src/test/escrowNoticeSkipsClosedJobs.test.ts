/**
 * Q1995 (lh-money-escrow@af0fbedd6#1): a cancelled job that a late bank settlement promotes to escrow
 * (paymentIntentSucceeded; void-cancelled-payments refunds it within the hour) must not tell the poster "Payment
 * secured ... will be released after the job is completed" nor the Helpr "Job funded". The effective definition of
 * notify_on_payment_escrowed (the one the database runs, rewrites included) guards its escrow block on the job's
 * status. Behaviour proof: src/test/pglite/escrowNoticeSkipsClosedJobs.pglite.mjs (cancelled/completed silent, open
 * and accepted still told, planted defects red).
 *
 * @mutate supabase/migrations/20261102071109_escrow_notice_skips_closed_jobs.sql |      AND COALESCE(NEW.status::text, '') NOT IN ('cancelled', 'completed') THEN |      AND COALESCE(NEW.status::text, '') NOT IN ('completed') THEN
 * @mutate supabase/migrations/20261102071109_escrow_notice_skips_closed_jobs.sql |      AND COALESCE(NEW.status::text, '') NOT IN ('cancelled', 'completed') THEN |      AND true THEN
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

describe("Q1995: the escrow notice skips a job that is already over", () => {
  const defs = effectiveDefs(MIGRATIONS);
  const def = defs.get("notify_on_payment_escrowed")?.stmt ?? "";

  it("reads the effective definition (inventory floor)", () => {
    expect(defs.size).toBeGreaterThan(500);
    expect(def).toMatch(/v_title := 'Payment secured';/);
  });

  it("the escrow block's condition excludes cancelled and completed jobs", () => {
    const cond = [...def.matchAll(/IF\s+([\s\S]*?)\s+THEN/g)].map((m) => m[1]).find((c) => /NEW\.payment_status = 'escrow'/.test(c)) ?? "";
    expect(cond).not.toBe("");
    expect(cond.replace(/\s+/g, " ")).toContain("AND COALESCE(NEW.status::text, '') NOT IN ('cancelled', 'completed')");
  });
});
