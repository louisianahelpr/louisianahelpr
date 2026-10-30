/**
 * Declutter haul-away: the daily sweep (20261027165903_declutter_haul_away_sweep;
 * docs/specs/declutter-haul-away.md H1; Q1962, the condition the
 * declutter_haul_away switch waits on before it goes to everyone). The fast
 * half of the proof, read from the NEWEST definitions the migrations leave
 * (effectiveDefs), so a later restatement that drops the once-only mark, a
 * switch gate, a money condition or the hold rule fails here.
 *
 * Behaviour (measured 2026-10-27): src/test/pglite/declutterHaulAwaySweep.pglite.mjs
 * 86/86 with the migration applied 3x on prod's bodies (md5(prosrc) checked);
 * RED 31/86 with NEW_MIGRATION=skip (no notice, no job abandoned, items stay
 * off sale); planted copies with no mark, no PaymentIntent guard, unpaid
 * jobs restored, no hold check, no switch gate, no gift guard, no 7-day
 * age, and Part C without the PaymentIntent or gift guard each RED (2-6 checks).
 *
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |         ON CONFLICT (item_id) DO NOTHING | ON CONFLICT (item_id) DO UPDATE SET notified_at = now()
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |        AND public.feature_enabled_for_user('declutter_haul_away', i.seller_id) |        AND true
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |        AND NOT public.declutter_member_out(i.seller_id) |        AND true
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |          AND j.stripe_payment_intent_id IS NULL\n         AND j.updated_at <= now() - interval '1 day'\n         AND NOT EXISTS |          AND j.updated_at <= now() - interval '1 day'\n         AND NOT EXISTS
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |                           WHERE g.job_id = j.id AND g.status IN ('reserved', 'redeemed')); |                           WHERE false);
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |         IF v_pay IS DISTINCT FROM 'abandoned' OR v_job_touched |         IF v_job_touched
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |  OR v_pi IS NOT NULL\n | \n
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |                        WHERE g.job_id = v_link.job_id AND g.status IN ('reserved', 'redeemed')) THEN |                        WHERE false) THEN
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |               AND j.stripe_payment_intent_id IS NULL)) |               AND true))
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |      FOR UPDATE OF j SKIP LOCKED |      
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |       ELSIF v_hold <> 'none' THEN |       ELSIF false THEN
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |         IF v_photos BETWEEN 3 AND 12 THEN |         IF true THEN
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |       IF NOT FOUND OR v_link.updated_at > now() - interval '7 days' THEN |       IF NOT FOUND THEN
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql | REVOKE ALL ON FUNCTION public.declutter_haul_away_sweep() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_haul_away_sweep() FROM PUBLIC;
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |     PERFORM cron.schedule('declutter-haul-away', '21 15 * * *', |     PERFORM cron.schedule('declutter-haul-away', '23 3 * * *',
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |     WHEN OTHERS THEN\n      v_errors := v_errors + 1;\n      PERFORM public.log_cron_defect('declutter_haul_away_sweep', r.item_id::text, |     WHEN division_by_zero THEN\n      v_errors := v_errors + 1;\n      PERFORM public.log_cron_defect('declutter_haul_away_sweep', r.item_id::text,
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |     EXCEPTION WHEN lock_not_available THEN\n      v_locked := v_locked + 1;\n    WHEN OTHERS THEN\n      v_errors := v_errors + 1;\n      PERFORM public.log_cron_defect('declutter_haul_away_sweep', r.item_id::text, |     EXCEPTION WHEN OTHERS THEN\n      v_errors := v_errors + 1;\n      PERFORM public.log_cron_defect('declutter_haul_away_sweep', r.item_id::text,
 * @mutate supabase/migrations/20261027165903_declutter_haul_away_sweep.sql |       v_hold := public.declutter_haul_job_hold(v_link.job_id); |       v_hold := 'none';
 * @mutate src/test/pglite/declutterHaulAwaySweep.pglite.mjs | if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIG); | if (!skip) await db.exec(MIG);
 * @mutate docs/archive/OPEN-done-2026-10.md | done-when: test src/test/declutterHaulAwaySweep.test.ts. | done-when: later.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FILE = "20261027165903_declutter_haul_away_sweep.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const SWEEP = flat(body("declutter_haul_away_sweep"));
const at = (needle: string) => SWEEP.indexOf(needle);

/** The newest schedule any migration gives a cron job (comments blanked; the guard reads every file). */
function newestSchedule(job: string): string | null {
  let out: string | null = null;
  const re = new RegExp(String.raw`cron\.(schedule|unschedule)\s*\(\s*'${job}'(?:\s*,\s*'([^']+)')?`, "g");
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql")).sort()) {
    for (const m of blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8")).matchAll(re)) out = m[1] === "unschedule" ? null : (m[2] ?? out);
  }
  return out;
}

describe("Declutter haul-away daily sweep (20261027165903, Q1962)", () => {
  it("reads a real inventory (floors)", () => {
    expect(SWEEP.length).toBeGreaterThan(3_000);
    expect(DEFS.get("declutter_haul_away_sweep")?.file).toBe(FILE);
    expect(body("declutter_haul_away_state").length).toBeGreaterThan(1_000);
    expect(body("declutter_haul_job_hold").length).toBeGreaterThan(500);
  });

  it("service role only: the sweep and the notified-at mark have no client privilege", () => {
    const m = flat(MIG);
    expect(m).toContain("REVOKE ALL ON FUNCTION public.declutter_haul_away_sweep() FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.declutter_haul_away_sweep() TO service_role;");
    expect(m).toContain("REVOKE ALL ON TABLE public.declutter_haul_away_notices FROM PUBLIC, anon, authenticated; GRANT ALL ON TABLE public.declutter_haul_away_notices TO service_role;");
    expect(m).not.toMatch(/GRANT [A-Z, ]+ ON (?:TABLE )?public\.declutter_haul_away_notices TO [a-z_, ]*(?:anon|authenticated)/);
    expect(m).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.declutter_haul_away_sweep\(\) TO [a-z_, ]*(?:anon|authenticated)/);
    expect(m).toContain("item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE");
  });

  it("A: the notice uses My listings' own 14-day rule, both switches and the member gate, and marks each listing before telling", () => {
    // The same rule as declutter_haul_away_state (My listings) and declutter_link_haul_away.
    const RULE = "COALESCE(i.live_at, i.submitted_at, i.created_at) + interval '14 days'";
    expect(flat(body("declutter_haul_away_state"))).toContain(`${RULE} AS due`);
    expect(flat(body("declutter_link_haul_away"))).toContain("COALESCE(v_item.live_at, v_item.submitted_at, v_item.created_at) + interval '14 days' > now()");
    expect(SWEEP).toContain(`WHERE i.status = 'live' AND ${RULE} <= now()`);
    expect(SWEEP).toContain("AND NOT EXISTS (SELECT 1 FROM public.declutter_haul_aways h WHERE h.item_id = i.id)");
    expect(SWEEP).toContain("WHERE c.item_id = i.id AND c.status IN ('in_cart', 'paid'))");
    expect(SWEEP).toContain("AND public.feature_enabled_for_user('declutter', i.seller_id) AND public.feature_enabled_for_user('declutter_haul_away', i.seller_id) AND NOT public.declutter_member_out(i.seller_id)");
    // Once per listing: the claim (ON CONFLICT DO NOTHING ... RETURNING) comes before any notice.
    const claim = at("INSERT INTO public.declutter_haul_away_notices (item_id) SELECT x FROM unnest(r.ids) x ON CONFLICT (item_id) DO NOTHING RETURNING item_id");
    expect(claim).toBeGreaterThan(0);
    expect(at("PERFORM public.declutter_notify(r.seller_id, 'info', 'Haul-away is open'")).toBeGreaterThan(claim);
    expect(SWEEP).toContain("AND NOT EXISTS (SELECT 1 FROM public.declutter_haul_away_notices n WHERE n.item_id = i.id)");
    // Through declutter_notify with the seller as the other party (the seed rule), never a raw insert.
    expect(SWEEP.match(/PERFORM public\.declutter_notify\(r\.seller_id, 'info', 'Haul-away is open', [^;]*?'\/declutter\?view=mine', r\.seller_id\);/g)).toHaveLength(2);
    expect(SWEEP).not.toMatch(/INSERT\s+INTO\s+public\.notifications/i);
  });

  it("B: only a never-funded declined card's haul-away job, checkout gone, no gift, quiet a day, becomes 'abandoned'", () => {
    const upd = SWEEP.slice(at("UPDATE public.jobs j SET payment_status = 'abandoned'"));
    expect(at("UPDATE public.jobs j SET payment_status = 'abandoned'")).toBeGreaterThan(0);
    const where = upd.slice(0, upd.indexOf("GET DIAGNOSTICS"));
    for (const cond of ["WHERE j.id = r.id", "AND j.status = 'open'", "AND j.payment_status = 'failed'", "AND j.stripe_session_id IS NULL",
      "AND j.stripe_payment_intent_id IS NULL", "AND j.updated_at <= now() - interval '1 day'",
      "AND NOT EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.job_id = j.id AND g.status IN ('reserved', 'redeemed'));"]) {
      expect(where, cond).toContain(cond);
    }
    // Only haul-away jobs, and the only write to public.jobs in the sweep.
    expect(SWEEP).toContain("FROM public.jobs j WHERE j.status = 'open' AND j.payment_status = 'failed'");
    expect(SWEEP).toContain("AND EXISTS (SELECT 1 FROM public.declutter_haul_aways h WHERE h.job_id = j.id) ORDER BY j.id LIMIT 200 FOR UPDATE OF j SKIP LOCKED LOOP");
    expect(SWEEP.match(/UPDATE\s+public\.jobs/gi)).toHaveLength(1);
    expect(SWEEP).not.toMatch(/DELETE\s+FROM\s+public\.jobs/i);
  });

  it("C: a link is undone only after 7 days, only when the job holds nothing, under the undo's lock order and photo rule", () => {
    // Candidates come from a lock-free read (taking job or link locks first would invert the lock order);
    // it decides nothing, and every condition is re-checked below under the item, job and link locks.
    const CAND = flat(body("declutter_haul_away_sweep_candidates"));
    expect(CAND).toContain("WHERE h.updated_at <= now() - interval '7 days'");
    expect(CAND).toContain("OR (j.status = 'open' AND j.payment_status = 'abandoned' AND j.updated_at <= now() - interval '1 day' AND j.stripe_payment_intent_id IS NULL))");
    expect(CAND).toContain("LANGUAGE sql STABLE");
    expect(CAND).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(flat(MIG)).toContain("REVOKE ALL ON FUNCTION public.declutter_haul_away_sweep_candidates(integer) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.declutter_haul_away_sweep_candidates(integer) TO service_role;");
    expect(SWEEP).toContain("SELECT c.item_id FROM public.declutter_haul_away_sweep_candidates(500) c LOOP");
    expect(SWEEP).toContain("IF NOT FOUND OR v_link.updated_at > now() - interval '7 days' THEN CONTINUE;");
    const item = at("FROM public.declutter_items i WHERE i.id = r.item_id FOR UPDATE;");
    const hold = at("v_hold := public.declutter_haul_job_hold(v_link.job_id);");
    const linkLock = at("PERFORM 1 FROM public.declutter_haul_aways h WHERE h.item_id = r.item_id FOR UPDATE;");
    const del = at("DELETE FROM public.declutter_haul_aways WHERE item_id = r.item_id");
    expect(item).toBeGreaterThan(0);
    expect(hold).toBeGreaterThan(item);
    expect(linkLock).toBeGreaterThan(hold);
    expect(del).toBeGreaterThan(linkLock);
    const rule = SWEEP.slice(hold, linkLock);
    expect(rule).toContain("IF v_hold = 'job_open' THEN");
    // Part B's money guards on the 'abandoned' branch too (lh-money-escrow review 2026-10-27 #2), in the
    // candidate query and again under the job lock.
    expect(rule).toContain("IF v_pay IS DISTINCT FROM 'abandoned' OR v_job_touched > now() - interval '1 day' OR v_pi IS NOT NULL OR EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.job_id = v_link.job_id AND g.status IN ('reserved', 'redeemed')) THEN CONTINUE;");
    expect(rule).toContain("ELSIF v_hold <> 'none' THEN CONTINUE;");
    expect(SWEEP).toContain("IF v_status = 'ended' AND v_link.prior_status = 'live' THEN");
    expect(SWEEP).toContain("IF v_photos BETWEEN 3 AND 12 THEN UPDATE public.declutter_items SET status = 'live'");
    // The hold rule the sweep trusts still says what it did when this was written (job_open = deletable, never-paid).
    const h = flat(body("declutter_haul_job_hold"));
    expect(h).toContain("RETURN CASE WHEN v_session IS NOT NULL AND v_pay <> 'abandoned' THEN 'paying' WHEN v_pay = 'failed' THEN 'job_stuck' ELSE 'job_open' END;");
    expect(h).toMatch(/RETURN 'booked'; END;/);
  });

  it("every item or job is its own sub-block: a failure is logged and the run goes on; locks never hang the run", () => {
    // A lock wait (55P03) is skipped for the next day, never a paged defect (review 2026-10-27 #6).
    expect(SWEEP.match(/EXCEPTION WHEN lock_not_available THEN v_locked := v_locked \+ 1; WHEN OTHERS THEN v_errors := v_errors \+ 1; PERFORM public\.log_cron_defect\(/g)).toHaveLength(3);
    expect(SWEEP).toContain("PERFORM public.log_cron_defect('declutter_haul_away_sweep', r.item_id::text,");
    expect(SWEEP).toContain("SET lock_timeout TO '1s'");
    expect(SWEEP).not.toMatch(/RAISE\s+EXCEPTION/i);
    expect(SWEEP).toMatch(/LIMIT 500 LOOP[^]*LIMIT 200 FOR UPDATE OF j SKIP LOCKED LOOP[^]*sweep_candidates\(500\) c LOOP/);
  });

  it("the cron runs daily in Louisiana daytime and records its work", () => {
    const sched = newestSchedule("declutter-haul-away");
    expect(sched).toBe("21 15 * * *");
    const hourUtc = Number(sched!.split(" ")[1]);
    // 14:00-22:59 UTC is 9 AM-5 PM in Louisiana in both CST and CDT.
    expect(hourUtc).toBeGreaterThanOrEqual(14);
    expect(hourUtc).toBeLessThanOrEqual(22);
    expect(flat(MIG)).toContain("$c$SELECT public.cron_record_work('declutter-haul-away', to_jsonb(public.declutter_haul_away_sweep()));$c$");
    expect(flat(MIG)).toContain("VALUES ('declutter-haul-away', interval '26 hours',");
  });

  it("the proof runs the migration 3x on prod's bodies, has a RED mode, and Q1962 carries its prod-readable done-when", () => {
    const proof = readFileSync(join(ROOT, "src/test/pglite/declutterHaulAwaySweep.pglite.mjs"), "utf8");
    expect(proof).toContain("if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIG);");
    expect(proof).toContain('process.env.NEW_MIGRATION === "skip"');
    expect(proof).toMatch(/declutter_haul_job_hold: "[0-9a-f]{32}"/);
    expect(proof).toMatch(/declutter_notify: "[0-9a-f]{32}"/);
    // In docs/OPEN.md until it is ticked, then in the monthly archive (scripts/archive-done.mjs).
    const ARCHIVE = join(ROOT, "docs/archive");
    const files = [join(ROOT, "docs/OPEN.md"), ...readdirSync(ARCHIVE).filter((f) => /^OPEN-done-\d{4}-\d{2}\.md$/.test(f)).map((f) => join(ARCHIVE, f))];
    const items = files.flatMap((f) => readFileSync(f, "utf8").split("\n"))
      .filter((l) => /^- \[[ ~x]\] \*\*Q\S+ [A-Z]+ Declutter haul-away: tell the seller \(bell \+ push\)/.test(l));
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item).toContain(FILE.replace(".sql", ""));
    if (!item.startsWith("- [x]")) {
      expect(item).toContain("done-when: sql `SELECT count(*) FROM cron.job WHERE jobname = 'declutter-haul-away' AND schedule = '21 15 * * *' AND active` => 1");
      expect(item).toContain("done-when: test src/test/declutterHaulAwaySweep.test.ts.");
    }
  });
});
