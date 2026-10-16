/**
 * Declutter haul-away (20261016053639_declutter_haul_away; owner 2026-10-16,
 * spec row 73, docs/specs/declutter-haul-away.md). The fast half of the proof,
 * read from the NEWEST definitions the migrations leave (effectiveDefs), so a
 * later restatement that drops a gate, a lock or the paid-job rule fails here.
 *
 * Behaviour (72 checks, 3x replay, migration skipped = RED 66 of 72; a planted
 * lenient hold rule, a planted "unknown = none" and a planted 0-photo restore
 * each caught, measured 2026-10-16): src/test/pglite/declutterHaulAway.pglite.mjs.
 *
 * @mutate supabase/migrations/20261016053639_declutter_haul_away.sql |   PERFORM public.require_feature('declutter_haul_away');\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n  SELECT COALESCE | IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n  SELECT COALESCE
 * @mutate supabase/migrations/20261016053639_declutter_haul_away.sql |      WHERE i.id = v_id AND i.seller_id = v_uid FOR UPDATE; |      WHERE i.id = v_id AND i.seller_id = v_uid;
 * @mutate supabase/migrations/20261016053639_declutter_haul_away.sql |   RETURN 'booked';\nEND; |   RETURN 'none';\nEND;
 * @mutate supabase/migrations/20261016053639_declutter_haul_away.sql |                  THEN CASE WHEN j.stripe_session_id IS NULL OR j.payment_status = 'abandoned' THEN 'job_open' ELSE 'paying' END | THEN 'job_open'
 * @mutate supabase/migrations/20261016053639_declutter_haul_away.sql | REVOKE ALL ON FUNCTION public.declutter_link_haul_away(uuid[], uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_link_haul_away(uuid[], uuid) FROM PUBLIC;
 * @mutate supabase/migrations/20261016053639_declutter_haul_away.sql |       IF COALESCE(v_item.live_at, v_item.submitted_at, v_item.created_at) + interval '14 days' > now() THEN | IF false THEN
 * @mutate supabase/migrations/20261016053639_declutter_haul_away.sql | VALUES ('declutter_haul_away', 'testers', | VALUES ('declutter_haul_away', 'everyone',
 * @mutate supabase/migrations/20261016053639_declutter_haul_away.sql | REVOKE ALL ON TABLE public.declutter_haul_aways FROM PUBLIC, anon, authenticated; | REVOKE ALL ON TABLE public.declutter_haul_aways FROM PUBLIC, anon;\nGRANT SELECT ON TABLE public.declutter_haul_aways TO authenticated;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const FILE = "20261016053639_declutter_haul_away.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

const RPCS = ["declutter_haul_away_state", "declutter_link_haul_away", "declutter_cancel_haul_away"];
const HELPER = "declutter_haul_job_hold";
const WRITES = ["declutter_link_haul_away", "declutter_cancel_haul_away"];

describe("Declutter haul-away (20261016053639)", () => {
  it("reads a real inventory (floors)", () => {
    for (const fn of RPCS) expect(body(fn), fn).not.toBe("");
    expect(RPCS.length).toBeGreaterThan(2);
    expect(MIG.length).toBeGreaterThan(8_000);
  });

  it("hidden: the switch is created for testers, and every RPC requires it AND 'declutter'", () => {
    expect(flat(MIG)).toContain("VALUES ('declutter_haul_away', 'testers',");
    for (const fn of RPCS) {
      const b = flat(body(fn));
      expect(b, fn).toContain("PERFORM public.require_feature('declutter');");
      expect(b, fn).toContain("PERFORM public.require_feature('declutter_haul_away');");
    }
  });

  it("writes refuse a banned caller; every RPC is revoked from anon; the link table has no client privilege", () => {
    for (const fn of WRITES) expect(flat(body(fn)), fn).toContain("IF public.is_caller_banned() THEN RAISE EXCEPTION 'account_restricted'");
    expect(flat(MIG)).toContain("REVOKE ALL ON FUNCTION public.declutter_haul_away_state(uuid[]) FROM PUBLIC, anon;");
    expect(flat(MIG)).toContain("REVOKE ALL ON FUNCTION public.declutter_link_haul_away(uuid[], uuid) FROM PUBLIC, anon;");
    expect(flat(MIG)).toContain("REVOKE ALL ON FUNCTION public.declutter_cancel_haul_away(uuid, uuid) FROM PUBLIC, anon;");
    expect(flat(MIG)).toContain("REVOKE ALL ON FUNCTION public.declutter_haul_job_hold(uuid) FROM PUBLIC, anon, authenticated;");
    expect(flat(MIG)).toContain("REVOKE ALL ON TABLE public.declutter_haul_aways FROM PUBLIC, anon, authenticated; GRANT ALL ON TABLE public.declutter_haul_aways TO service_role;");
    expect(flat(MIG)).not.toMatch(/GRANT [A-Z, ]+ ON TABLE public\.declutter_haul_aways TO [a-z_, ]*authenticated/);
  });

  it("the link locks the caller's open job and each item, and re-checks the rules under the lock", () => {
    const b = flat(body("declutter_link_haul_away"));
    expect(b).toContain("WHERE j.id = p_job_id AND j.customer_id = v_uid AND j.status = 'open' AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed') FOR UPDATE");
    expect(b).toContain("WHERE i.id = v_id AND i.seller_id = v_uid FOR UPDATE;");
    expect(b).toContain("WHERE c.item_id = v_item.id AND c.status IN ('in_cart', 'paid'))");
    expect(b).toContain("+ interval '14 days' > now() THEN RAISE EXCEPTION 'haul_away_too_soon'");
    expect(b).toContain("RAISE EXCEPTION 'haul_away_addresses_differ'");
    expect(b).toContain("UPDATE public.declutter_items SET status = 'ended'");
    expect(b).toContain("SET status = 'voided', closed_at = now(), updated_at = now() WHERE item_id = v_item.id AND status = 'open'");
  });

  it("money in flight (reviews 2026-10-16): one fail-closed hold rule; move/undo only when the job holds nothing", () => {
    const hold = flat(body(HELPER));
    expect(hold).toContain("FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;");
    expect(hold).toContain("IF v_status = 'cancelled' AND v_pay IN ('unpaid', 'abandoned', 'failed', 'refunded', 'cancelled') THEN RETURN 'none';");
    expect(hold).toContain("RETURN CASE WHEN v_session IS NULL OR v_pay = 'abandoned' THEN 'job_open' ELSE 'paying' END;");
    expect(hold).toMatch(/RETURN 'booked'; END;/);
    for (const fn of WRITES) {
      const b = flat(body(fn));
      expect(b, fn).toContain(`v_hold := public.${HELPER}(v_link.job_id);`);
      expect(b, fn).toContain("IF v_hold = 'paying' THEN RAISE EXCEPTION 'haul_away_checkout_open'");
      expect(b, fn).toContain("ELSIF v_hold = 'job_open' THEN RAISE EXCEPTION 'haul_away_job_open'");
      expect(b, fn).toContain("ELSIF v_hold <> 'none' THEN RAISE EXCEPTION 'haul_away_already_booked'");
    }
    // The state read restates the same rule inline (a read takes no lock): kept identical here.
    const st = flat(body("declutter_haul_away_state"));
    expect(st).toContain("WHEN j.status = 'cancelled' AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed', 'refunded', 'cancelled') THEN 'none'");
    expect(st).toContain("THEN CASE WHEN j.stripe_session_id IS NULL OR j.payment_status = 'abandoned' THEN 'job_open' ELSE 'paying' END ELSE 'booked'");
    // Lock order: items, then jobs, then link rows (no deadlock with undo).
    expect(flat(body("declutter_link_haul_away"))).toMatch(/ORDER BY i\.id FOR UPDATE;[^]*?WHERE j\.id = p_job_id[^]*?FOR UPDATE/);
    expect(flat(MIG)).toContain("job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,");
    expect(flat(body("declutter_cancel_haul_away"))).toContain("BETWEEN 3 AND 12 THEN UPDATE public.declutter_items SET status = 'live'");
    expect(MIG).not.toMatch(/UPDATE\s+public\.jobs|DELETE\s+FROM\s+public\.jobs/i);
  });

  it("no new money path: nothing here touches payments, payouts, refunds or Stripe", () => {
    expect(MIG).not.toMatch(/declutter_(orders|payouts|refunds|buyer_cards)|create-payment/i);
    // stripe_session_id is only READ (the hold rule); no Stripe object is named otherwise.
    expect(MIG.replace(/stripe_session_id/g, "")).not.toMatch(/stripe/i);
  });
});
