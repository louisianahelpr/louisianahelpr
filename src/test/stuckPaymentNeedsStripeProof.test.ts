/**
 * A "stuck payment" alert needs Stripe's word that the money MOVED (owner
 * report, 2026-10-09).
 *
 * THE FALSE ALARM: detect_stuck_payments paged for every real job still
 * 'unpaid' 10 minutes after its checkout opened. At 12:15Z on 2026-10-09 that
 * was Ben's "Grass cutting" job, whose session Stripe reported open/unpaid with
 * no PaymentIntent (he never paid). SQL could not ask Stripe, so an unfinished
 * checkout looked exactly like a dropped webhook.
 *
 * THE CLASS: any SQL function that raises the stuck-payment alert (title
 * "Stuck payment …", or the 'detect_stuck_payments' error_logs source) must
 * gate it on stuck_payment_stripe_checks.money_moved, which only the edge
 * function stuck-payment-check writes from Stripe's own answer
 * (src/test/edge/stuck-payment-check.test.ts pins what "moved" means). Inventory
 * from the effective definitions (later rewrites applied), comments blanked.
 *
 * Red on the original: run against origin/main 6f4775024 the gate test fails
 * (detect_stuck_payments has no money_moved). Behaviour, both cases:
 * src/test/pglite/stuckPaymentNeedsStripeProof.pglite.mjs.
 *
 * @mutate supabase/migrations/20261009142754_stuck_payment_needs_stripe_proof.sql |       IF rec.money_moved IS NOT TRUE THEN |       IF false THEN
 * @mutate supabase/migrations/20261009142754_stuck_payment_needs_stripe_proof.sql |           ON c.job_id = j.id AND c.stripe_session_id = j.stripe_session_id |           ON c.job_id = j.id
 * @mutate supabase/migrations/20261009142754_stuck_payment_needs_stripe_proof.sql | 'seed_already_logged', 'not_paid'], 2, | 'seed_already_logged', 'not_paid', 'awaiting_stripe'], 2,
 * @mutate supabase/migrations/20261009142754_stuck_payment_needs_stripe_proof.sql |     PERFORM cron.schedule('stuck-payment-check', '12-59/15 * * * *', |     PERFORM cron.schedule('stuck-payment-check', '0 * * * *',
 * @mutate supabase/migrations/20261009142754_stuck_payment_needs_stripe_proof.sql |           IF greatest(rec.created_at, coalesce(rec.updated_at, rec.created_at)) < NOW() - INTERVAL '40 minutes' THEN |           IF false THEN
 * @mutate supabase/migrations/20261009142754_stuck_payment_needs_stripe_proof.sql |     ORDER BY (c.money_moved IS TRUE) DESC, (c.checked_at IS NULL) DESC, j.created_at\n | \n
 * @mutate supabase/migrations/20261009142754_stuck_payment_needs_stripe_proof.sql |                  AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = j.customer_id)) AS seed, |                  AND true) AS seed,
 * @mutate supabase/migrations/20261009142754_stuck_payment_needs_stripe_proof.sql |            AND e.tags ->> 'job_id' = rec.id::text\n           AND e.message = 'Stuck payment detected — webhook noop' |            AND e.message = 'Stuck payment detected — webhook noop'
 * @mutate supabase/config.toml |   [functions.stuck-payment-check]\n    verify_jwt = false |   [functions.stuck-payment-check]\n    verify_jwt = true
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");
const defs = effectiveDefs(MIG);
const code = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "");

/** Every effective function that raises the stuck-payment alert. */
const RAISES = /insert\s+into\s+(?:public\.)?notifications\b[\s\S]*'stuck payment|'source'\s*,\s*'detect_stuck_payments'/i;
const raisers = [...defs.keys()].filter((name) => RAISES.test(code(name)));

const migrations = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const allSql = migrations.map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8")));

describe("the stuck-payment alert needs Stripe's proof that money moved", () => {
  it("finds the alert's raisers (inventory floor)", () => {
    expect(raisers).toContain("detect_stuck_payments");
    expect(raisers.length).toBeGreaterThan(0);
  });

  it("every raiser reads Stripe's answer and skips a checkout that took no money before any alert write", () => {
    const bad = raisers.filter((name) => {
      const c = code(name);
      const gate = c.search(/IF\s+rec\.money_moved\s+IS\s+NOT\s+TRUE\s+THEN/i);
      const firstAlert = c.search(/insert\s+into\s+(?:public\.)?(?:notifications|error_logs)\b/i);
      return !/stuck_payment_stripe_checks/i.test(c) || gate < 0 || firstAlert < 0 || gate > firstAlert;
    });
    expect(bad, "gate the alert on stuck_payment_stripe_checks.money_moved (Stripe's answer), before any notification or error_logs write").toEqual([]);
  });

  it("trusts only an answer about the job's CURRENT session", () => {
    expect(code("detect_stuck_payments")).toMatch(/ON\s+c\.job_id\s*=\s*j\.id\s+AND\s+c\.stripe_session_id\s*=\s*j\.stripe_session_id/i);
  });

  it("not_paid counts as handled work; awaiting_stripe never does (a dead checker must still page)", () => {
    // Newest registration of the detector's dispositions.
    let keys: string[] | null = null;
    for (const sql of allSql) {
      for (const m of sql.matchAll(/\(\s*'detect-stuck-payments'\s*,\s*'found'\s*,\s*ARRAY\[([^\]]*)\]/g)) {
        keys = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
      }
    }
    expect(keys).toContain("not_paid");
    expect(keys).not.toContain("awaiting_stripe");
    expect(code("detect_stuck_payments")).toMatch(/'not_paid'\s*,\s*v_not_paid/);
    expect(code("detect_stuck_payments")).toMatch(/'awaiting_stripe'\s*,\s*v_awaiting_stripe/);
    // …and each unanswered job is filed on its own, so it cannot hide behind
    // another job answered not_paid in the same run.
    expect(code("detect_stuck_payments")).toMatch(
      /v_awaiting_stripe\s*:=\s*v_awaiting_stripe\s*\+\s*1\s*;\s*IF\s+greatest\(rec\.created_at,\s*coalesce\(rec\.updated_at,\s*rec\.created_at\)\)\s*<\s*NOW\(\)\s*-\s*INTERVAL\s+'40 minutes'\s+THEN\s+PERFORM\s+public\.log_cron_defect\(/i,
    );
  });

  it("a job Stripe says was PAID is never crowded out of the 50-row window, and is paged per job", () => {
    const body = code("detect_stuck_payments");
    expect(body).toMatch(/ORDER\s+BY\s+\(c\.money_moved\s+IS\s+TRUE\)\s+DESC\s*,\s*\(c\.checked_at\s+IS\s+NULL\)\s+DESC[^;]*?LIMIT\s+50/i);
    // A TEST account is is_seed AND a test_accounts row; is_seed alone is a real
    // person with a fixture inbox, whose live money must page.
    expect(body).toMatch(/AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.test_accounts\s+t\s+WHERE\s+t\.user_id\s*=\s*j\.customer_id\s*\)\s*\)\s+AS\s+seed/i);
    // Deduped per JOB (error_logs job_id), not per poster.
    expect(body).toMatch(/e\.tags\s*->>\s*'source'\s*=\s*'detect_stuck_payments'\s+AND\s+e\.tags\s*->>\s*'job_id'\s*=\s*rec\.id::text/i);
    expect(body).not.toMatch(/n\.link\s*=\s*format\('\/admin\?view=people&user=%s',\s*rec\.customer_id\)/i);
  });

  it("the Stripe checker is scheduled before each detector run and callable by the schedule", () => {
    const sched = allSql.join("\n").match(/cron\.schedule\(\s*'stuck-payment-check'\s*,\s*'([^']+)'/);
    expect(sched?.[1]).toBe("12-59/15 * * * *");
    const toml = readFileSync(join(ROOT, "supabase", "config.toml"), "utf8");
    expect(toml).toMatch(/\[functions\.stuck-payment-check\]\s*\n\s*verify_jwt\s*=\s*false/);
  });

  it("the table holding Stripe's answers is server-only", () => {
    const sql = allSql.join("\n");
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.stuck_payment_stripe_checks\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.stuck_payment_stripe_checks\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});
