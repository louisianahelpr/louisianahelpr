/**
 * Q417 (c), (d): the platform can end a recurring series. Before 20261012194707
 * only a party (end_recurring_series, auth.uid()) or a permanent ban
 * (end_series_for_banned_account) could; a chargeback only made
 * charge-recurring-visits skip the series on each run.
 *
 * Behaviour: src/test/pglite/seriesEndByPlatform.pglite.mjs (ALL PASS with the
 * migration applied 3x; 15 FAIL on main). The webhook half:
 * src/test/edge/chargebackEndsSeries.test.ts. This guard pins, from the NEWEST
 * definitions, the gates and the "both sides are told" rule.
 *
 * @mutate supabase/migrations/20261012194707_series_end_by_platform.sql |   IF NOT public.has_role(v_uid, 'admin') THEN |   IF false THEN
 * @mutate supabase/migrations/20261012194707_series_end_by_platform.sql |   IF public.is_series_party(v_parent_id)\n | IF false\n
 * @mutate supabase/migrations/20261012194707_series_end_by_platform.sql |                    AND (c.helper_id = v_uid OR c.recurring_helper_id = v_uid)) |                    AND false)
 * @mutate supabase/migrations/20261012205559_platform_series_end_refunds_in_full.sql |          format('Louisiana Helpr ended the recurring series "%s". No new visits will be booked or charged.%s', |          format('The recurring series "%s" has ended: a charge on it is being disputed with the bank.%s',
 * @mutate supabase/migrations/20261012194707_series_end_by_platform.sql |   IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN | IF false THEN
 * @mutate supabase/migrations/20261012205559_platform_series_end_refunds_in_full.sql |   IF v_job.customer_id IS NOT NULL THEN\n    INSERT INTO public.notifications | IF false THEN\n    INSERT INTO public.notifications
 * @mutate supabase/migrations/20261012205559_platform_series_end_refunds_in_full.sql |   IF v_job.status = 'cancelled' OR v_job.series_ended_on IS NOT NULL THEN | IF false THEN
 * @mutate supabase/migrations/20261012194707_series_end_by_platform.sql | REVOKE ALL ON FUNCTION public.end_recurring_series_by_platform(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.end_recurring_series_by_platform(uuid, text, text, uuid) FROM PUBLIC, anon;
 * @mutate supabase/migrations/20261012205559_platform_series_end_refunds_in_full.sql |   INSERT INTO public.series_platform_ends (parent_job_id, kind, reason, admin_id) |   PERFORM 1; -- (parent_job_id, kind, reason, admin_id)
 * @mutate supabase/migrations/20261012205559_platform_series_end_refunds_in_full.sql | REVOKE ALL ON public.series_platform_ends FROM PUBLIC, anon, authenticated; | REVOKE ALL ON public.series_platform_ends FROM PUBLIC, anon;
 * @mutate supabase/migrations/20261012205559_platform_series_end_refunds_in_full.sql | Any visit you already paid for that nobody is booked on is refunded in full.', | Any visit you already paid for that nobody is booked on is refunded, less the card processing fee.',
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = join(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const FIX = "20261012194707_series_end_by_platform.sql";
const defs = effectiveDefs(MIG);
const code = (fn: string) => {
  const d = defs.get(fn);
  expect(d, `${fn} has no migration definition`).toBeDefined();
  return blankSqlComments(d!.stmt).replace(/\s+/g, " ");
};

describe("the platform can end a recurring series (Q417 c, d)", () => {
  it("reads the real definitions (floor)", () => {
    expect(defs.size).toBeGreaterThan(400);
  });

  it("the admin RPC: signed in, admin, not a party, a real reason, then the platform end", () => {
    const a = code("rpc_admin_end_recurring_series");
    expect(a).toMatch(/SECURITY DEFINER/i);
    expect(a).toMatch(/IF NOT public\.has_role\(v_uid, 'admin'\) THEN RAISE/);
    expect(a).toMatch(/IF public\.is_series_party\(v_parent_id\) OR EXISTS \(SELECT 1 FROM public\.jobs c WHERE \(c\.parent_job_id = v_parent_id OR c\.id = v_parent_id\) AND \(c\.helper_id = v_uid OR c\.recurring_helper_id = v_uid\)\) OR EXISTS \(SELECT 1 FROM public\.series_visit_holds h/);
    expect(a).toMatch(/IF length\(btrim\(COALESCE\(p_reason, ''\)\)\) < 10 THEN RAISE/);
    expect(a).toMatch(/RETURN public\.end_recurring_series_by_platform\(p_job_id, 'admin', p_reason, v_uid\);/);
  });

  it("the platform end tells every Helpr on the series AND the poster, once", () => {
    const p = code("end_recurring_series_by_platform");
    expect(p).toMatch(/IF v_job\.status = 'cancelled' OR v_job\.series_ended_on IS NOT NULL THEN RETURN jsonb_build_object\( 'action', 'already_ended'/);
    expect(p).toMatch(/FROM public\.series_visit_holds h WHERE h\.parent_job_id = v_job\.id AND h\.visit_date >= v_today/);
    expect(p).toMatch(/IF v_job\.customer_id IS NOT NULL THEN INSERT INTO public\.notifications/);
    expect(p).toMatch(/SET series_ended_on = v_end/);
    expect(p).toMatch(/set_config\('app\.series_end_rpc', '1', true\)/);
    // The poster's bank dispute is private: a Helpr never reads it (money review #3).
    const sql = blankSqlComments(readFileSync(join(MIG, FIX), "utf8"));
    const helprBlock = sql.slice(sql.indexOf("'Recurring series ended',"), sql.indexOf("FROM ( SELECT h.helper_id") > 0 ? sql.indexOf("FROM ( SELECT h.helper_id") : sql.indexOf("FROM (\n      SELECT h.helper_id"));
    expect(helprBlock).not.toMatch(/disputed/);
    // The poster is told a paid, unbooked visit is refunded IN FULL: the platform
    // ended it (owner decision Q1733, 2026-10-12; was "less the card fee").
    expect(p).toMatch(/is refunded in full\./);
    expect(p).not.toMatch(/less the card processing fee/);
    // ...and the record charge-recurring-visits reads to refund in full.
    expect(p).toContain("INSERT INTO public.series_platform_ends (parent_job_id, kind, reason, admin_id) VALUES (v_job.id, p_kind, btrim(p_reason), p_admin) ON CONFLICT (parent_job_id) DO NOTHING;");
  });

  it("the platform end is service_role only; the admin RPC is not open to anon", () => {
    const mig = blankSqlComments(readFileSync(join(MIG, FIX), "utf8"));
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.end_recurring_series_by_platform\(uuid, text, text, uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(mig).not.toMatch(/GRANT [^;]*end_recurring_series_by_platform[^;]*\b(?:anon|authenticated)\b/);
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.rpc_admin_end_recurring_series\(uuid, text\) FROM PUBLIC, anon;/);
    // Q1733: no client can write the record that buys a full refund.
    const m2 = blankSqlComments(readFileSync(join(MIG, "20261012205559_platform_series_end_refunds_in_full.sql"), "utf8"));
    expect(m2).toMatch(/REVOKE ALL ON public\.series_platform_ends FROM PUBLIC, anon, authenticated;/);
    expect(m2).toMatch(/ALTER TABLE public\.series_platform_ends ENABLE ROW LEVEL SECURITY;/);
  });
});
