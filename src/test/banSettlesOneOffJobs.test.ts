// @mutate supabase/migrations/20260925234251_permanent_ban_settles_one_off_jobs.sql | 'chargeback'))                                                         -- MOVING | 'chargebak'))                                                         -- MOVING
// @mutate supabase/migrations/20260925234251_permanent_ban_settles_one_off_jobs.sql | WHEN p_status = 'disputed' THEN 'escalate_dispute' | WHEN p_status = 'disputed_x' THEN 'escalate_dispute'
// @mutate supabase/migrations/20260925234251_permanent_ban_settles_one_off_jobs.sql |                dispute_status = 'escalated'\n         WHERE id = v_job.id\n           AND status::text = v_job.status\n           AND payment_status = 'escrow'; |                dispute_status = 'open'\n         WHERE id = v_job.id\n           AND status::text = v_job.status\n           AND payment_status = 'escrow';
// @mutate supabase/migrations/20260925234251_permanent_ban_settles_one_off_jobs.sql | WHEN (NEW.ban_status IN ('banned', 'permanently_banned') | WHEN (NEW.ban_status IN ('permanently_banned')
// @mutate supabase/migrations/20260925234251_permanent_ban_settles_one_off_jobs.sql | v_percent := public.cancellation_fee_percent(v_committed, v_hours); | v_percent := 25;
// @mutate supabase/migrations/20260925234251_permanent_ban_settles_one_off_jobs.sql |     ELSE 'unhandled'\n  END\n$fn$; |     ELSE 'none_finished'\n  END\n$fn$;
// @mutate supabase/migrations/20260925234251_permanent_ban_settles_one_off_jobs.sql |     EXCEPTION WHEN OTHERS THEN | EXCEPTION WHEN division_by_zero THEN
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Constants } from "@/integrations/supabase/types";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { extractConstraints } from "./helpers/schemaConstraints";

/**
 * Q327 — a permanent ban settles every live one-off job the account is on.
 *
 * WHAT WAS BROKEN (found by the Q301 lh-money-escrow review, 2026-09-23): a
 * permanent ban wrote profiles.ban_status and nothing else. A banned poster's
 * funded jobs stayed live with applicants and a hired Helpr waiting; a banned
 * Helpr stayed hired on the poster's escrow.
 *
 * THE CLASS: every (job_status x jobs.payment_status) a banned party can be
 * in has a handled path. The inventory is the app's own: job_status from the
 * generated enum, payment_status from jobs_payment_status_check as the
 * migrations leave it. ban_settlement_action (effective definition) must name
 * every value of both, put every payment value in its money buckets (and
 * nothing that is not one), and end in ELSE 'unhandled', which the settle
 * function turns into an admin page, never a silent pass.
 *
 * Behaviour: src/test/pglite/banSettlesOneOffJobs.pglite.mjs seeds all
 * 8 x 11 x 2 x 2 combinations through the real jobs trigger chain and bans
 * the account; none may end unhandled, failed, or live and unseen.
 */

const MIG = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(MIG);
const body = (name: string) => {
  const d = DEFS.get(name);
  if (!d) throw new Error(`${name} is not defined by any migration`);
  return blankSqlComments(d.stmt).replace(/\s+/g, " ");
};
const literals = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

const JOB_STATUSES = [...Constants.public.Enums.job_status];
const payConstraint = extractConstraints().get("jobs")?.get("jobs_payment_status_check");
const PAYMENT_STATUSES = payConstraint && payConstraint.kind === "enum" ? payConstraint.values : [];

describe("Q327: a permanent ban settles every live one-off job (class guard)", () => {
  const action = body("ban_settlement_action");
  const settle = body("settle_one_off_jobs_for_banned_account");

  it("the inventory is real", () => {
    expect(JOB_STATUSES.length).toBeGreaterThan(7);
    expect(PAYMENT_STATUSES.length).toBeGreaterThan(9);
    expect(PAYMENT_STATUSES).toContain("escrow");
  });

  it("every payment_status is in a money bucket, and the buckets name nothing else (two-way)", () => {
    const m = /WHEN NOT \((.*?)\) THEN 'unhandled'/.exec(action);
    expect(m, "the money-bucket clause (WHEN NOT (...) THEN 'unhandled') is gone").toBeTruthy();
    const bucketed = new Set(literals(m![1]));
    expect(PAYMENT_STATUSES.filter((p) => !bucketed.has(p))).toEqual([]);
    expect([...bucketed].filter((p) => !PAYMENT_STATUSES.includes(p))).toEqual([]);
  });

  it("every job_status has a branch", () => {
    const named = new Set(
      [...action.matchAll(/p_status (?:= '([a-z_]+)'|IN \(([^)]*)\))/g)].flatMap((x) => (x[1] ? [x[1]] : literals(x[2]))),
    );
    expect(JOB_STATUSES.filter((s) => !named.has(s))).toEqual([]);
  });

  it("an unknown combination is 'unhandled', and the settle function pages admins on it instead of passing", () => {
    expect(action).toMatch(/ELSE 'unhandled' END \$fn\$/);
    expect(settle).toContain("public.ban_settlement_action(");
    expect(settle).toMatch(/ELSE RAISE EXCEPTION 'unhandled ban settlement/);
    // A failure never rolls the ban back: each job in its own subtransaction,
    // and the handler writes the admin page.
    expect(settle).toMatch(/EXCEPTION WHEN OTHERS THEN .*settling it failed/);
    expect(settle).toMatch(/'admin_alert', '\/admin\?view=jobs&job=' \|\| v_job\.id::text, v_job\.id/);
  });

  it("a funded cancel is priced exactly as poster_cancel_job prices it", () => {
    const cancel = body("poster_cancel_job");
    for (const piece of [
      "public.job_hours_until_start(v_job.date_needed, v_job.start_time, now())",
      "public.cancellation_fee_percent(v_committed, v_hours)",
      "v_committed := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL",
      "round(v_job.budget * v_percent) / 100.0",
      "public.is_late_cancellation(v_committed, v_hours)",
    ]) {
      expect(cancel, `poster_cancel_job no longer contains: ${piece}`).toContain(piece);
      expect(settle, `the ban settlement no longer contains: ${piece}`).toContain(piece);
    }
  });

  it("work started -> an ESCALATED platform dispute, which no timer settles", () => {
    expect(settle).toMatch(/INSERT INTO public\.disputes \(job_id, opener_id, reason, evidence_urls\) VALUES \(v_job\.id, NULL,/);
    expect(settle).toMatch(/SET status = 'disputed', disputed_by = NULL, disputed_at = now\(\), dispute_reason = v_dispute_reason, dispute_status = 'escalated' WHERE id = v_job\.id AND status::text = v_job\.status AND payment_status = 'escrow'/);
    const resolver = blankSqlComments(readFileSync(join(process.cwd(), "supabase/functions/auto-resolve-disputes/index.ts"), "utf8"));
    expect(resolver).toMatch(/if \(disputeStatus === "escalated"\) \{/);
    const release = readFileSync(join(process.cwd(), "supabase/functions/auto-release-payment/index.ts"), "utf8");
    const selected = [...release.matchAll(/\.(?:eq|in)\("status", (\[[^\]]*\]|"[a-z_]+")\)/g)].map((m) => m[1]).join(" ");
    expect(selected).not.toContain('"disputed"');
  });

  it("the trigger fires on every permanent ban value and only on a change", () => {
    const sql = blankSqlComments(readFileSync(join(MIG, "20260925234251_permanent_ban_settles_one_off_jobs.sql"), "utf8")).replace(/\s+/g, " ");
    expect(sql).toContain(
      "CREATE TRIGGER trg_settle_one_off_jobs_on_permanent_ban AFTER UPDATE OF ban_status ON public.profiles FOR EACH ROW WHEN (NEW.ban_status IN ('banned', 'permanently_banned') AND OLD.ban_status IS DISTINCT FROM NEW.ban_status)",
    );
    // Every value the purge path calls a ban, minus the temporary one.
    const purge = readFileSync(join(process.cwd(), "supabase/functions/_shared/accountPurge.ts"), "utf8");
    const bans = /BAN_STATUSES = \[([^\]]*)\]/.exec(purge)?.[1] ?? "";
    const permanent = [...bans.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).filter((s) => s !== "temp_banned");
    expect(permanent.length).toBeGreaterThan(1);
    for (const p of permanent) expect(sql).toContain(`'${p}'`);
  });

  it("nothing but the service role can run the settlement by hand", () => {
    const sql = blankSqlComments(readFileSync(join(MIG, "20260925234251_permanent_ban_settles_one_off_jobs.sql"), "utf8")).replace(/\s+/g, " ");
    for (const sig of [
      "ban_settlement_action(text, text, text, boolean, boolean, boolean)",
      "settle_one_off_jobs_for_banned_account(uuid)",
      "settle_one_off_jobs_on_permanent_ban()",
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
    }
  });
});
