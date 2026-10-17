/**
 * Declutter haul-away (20261017070827_declutter_haul_away; owner 2026-10-16,
 * spec row 73, docs/specs/declutter-haul-away.md). The fast half of the proof,
 * read from the NEWEST definitions the migrations leave (effectiveDefs), so a
 * later restatement that drops a gate, a lock or the paid-job rule fails here.
 *
 * Behaviour (109 checks, 3x replay, migration skipped = RED 99 of 109; the
 * pre-fix migration (47b81bb229) RED 2 of 83: the funded-job re-link and the
 * job_stuck hold; the migration before the full-refund rule (a6b60cd85) RED 11
 * of 109; measured 2026-10-17): src/test/pglite/declutterHaulAway.pglite.mjs.
 * It refuses to run (exit 2) when supabase/migrations holds a file on neither
 * origin/main nor the Declutter stack (shown with a planted file, 2026-10-17).
 *
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |   PERFORM public.require_feature('declutter_haul_away');\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n  SELECT COALESCE | IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n  SELECT COALESCE
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |      WHERE i.id = v_id AND i.seller_id = v_uid FOR UPDATE; |      WHERE i.id = v_id AND i.seller_id = v_uid;
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |   RETURN 'booked';\nEND; |   RETURN 'none';\nEND;
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |                  THEN CASE WHEN j.stripe_session_id IS NOT NULL AND COALESCE(j.payment_status, 'unpaid') <> 'abandoned' THEN 'paying' |                  THEN CASE WHEN false THEN 'paying'
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |     RETURN cardinality(v_ids);\n  END IF;\n\n  -- The caller's own OPEN |     NULL;\n  END IF;\n\n  -- The caller's own OPEN
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |            WHERE h.item_id = ANY (v_ids) AND h.job_id = p_job_id) = cardinality(v_ids) |            WHERE h.item_id = ANY (v_ids)) = cardinality(v_ids)
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |                 WHEN v_pay = 'failed' THEN 'job_stuck'\n |
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |                            WHEN j.payment_status = 'failed' THEN 'job_stuck'\n |
 * @mutate src/test/pglite/declutterHaulAway.pglite.mjs | if (foreign.length > 0) { | if (false) {
 * @mutate src/test/pglite/declutterHaulAway.pglite.mjs | const onMain = migrationsAt("origin/main"); | const onMain = readdirSync(MIG_DIR);
 * @mutate scripts/ci/definer-exec-allowlist.json | when every one is already linked to p_job_id and that job is the caller's | when the items are the caller's
 * @mutate src/pages/post-job/useHaulAwayPrefill.ts | const declutter = () => import("@/lib/declutter/haulAway"); | const declutter = () => Promise.all([import("@/lib/declutter/api"), import("@/lib/declutter/haulAway")]).then(([a, h]) => ({ ...a, ...h }));
 * @mutate src/components/declutter/DeclutterHomeView.tsx | import type { HaulAwayRow } from "@/lib/declutter/haulAwayParam"; | import { oneTripGroup, type HaulAwayRow } from "@/lib/declutter/haulAwayParam";\nvoid oneTripGroup;
 * @mutate src/lib/declutter/errors.ts |   // Haul-away (20261017070827): its words |   haul_away_too_many: "One haul-away can take up to 10 items.",\n  // Haul-away (20261017070827): its words
 * @mutate docs/OPEN.md |  CONDITION FOR GOING LIVE: the declutter_haul_away switch stays testers-only until the put-back-on-sale sweep below is live on prod |
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql | REVOKE ALL ON FUNCTION public.declutter_link_haul_away(uuid[], uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_link_haul_away(uuid[], uuid) FROM PUBLIC;
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |       IF COALESCE(v_item.live_at, v_item.submitted_at, v_item.created_at) + interval '14 days' > now() THEN | IF false THEN
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql | VALUES ('declutter_haul_away', 'testers', | VALUES ('declutter_haul_away', 'everyone',
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |   WHEN (NEW.payment_status = 'refunded' AND NEW.status IN ('completed', 'disputed', 'cancelled') |   WHEN (NEW.payment_status = 'chargeback' AND NEW.status IN ('completed', 'disputed', 'cancelled')
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |   EXCEPTION WHEN OTHERS THEN\n    -- The refund must land |   EXCEPTION WHEN division_by_zero THEN\n    -- The refund must land
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |   IF v_pay = 'refunded' AND v_status IN ('completed', 'disputed') THEN\n    RETURN 'none'; |   IF false THEN\n    RETURN 'none';
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql |       DELETE FROM public.declutter_haul_aways WHERE item_id = r.item_id AND job_id = NEW.id; |       PERFORM 1;
 * @mutate supabase/migrations/20261017070827_declutter_haul_away.sql | REVOKE ALL ON TABLE public.declutter_haul_aways FROM PUBLIC, anon, authenticated; | REVOKE ALL ON TABLE public.declutter_haul_aways FROM PUBLIC, anon;\nGRANT SELECT ON TABLE public.declutter_haul_aways TO authenticated;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const FILE = "20261017070827_declutter_haul_away.sql";
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

const RPCS = ["declutter_haul_away_state", "declutter_link_haul_away", "declutter_cancel_haul_away"];
const HELPER = "declutter_haul_job_hold";
const WRITES = ["declutter_link_haul_away", "declutter_cancel_haul_away"];

describe("Declutter haul-away (20261017070827)", () => {
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
    expect(hold).toContain("RETURN CASE WHEN v_session IS NOT NULL AND v_pay <> 'abandoned' THEN 'paying' WHEN v_pay = 'failed' THEN 'job_stuck' ELSE 'job_open' END;");
    expect(hold).toMatch(/RETURN 'booked'; END;/);
    for (const fn of WRITES) {
      const b = flat(body(fn));
      expect(b, fn).toContain(`v_hold := public.${HELPER}(v_link.job_id);`);
      expect(b, fn).toContain("IF v_hold = 'paying' THEN RAISE EXCEPTION 'haul_away_checkout_open'");
      expect(b, fn).toContain("ELSIF v_hold IN ('job_open', 'job_stuck') THEN RAISE EXCEPTION 'haul_away_job_open'");
      expect(b, fn).toContain("ELSIF v_hold <> 'none' THEN RAISE EXCEPTION 'haul_away_already_booked'");
    }
    // The state read restates the same rule inline (a read takes no lock): kept identical here.
    const st = flat(body("declutter_haul_away_state"));
    expect(st).toContain("WHEN j.status = 'cancelled' AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed', 'refunded', 'cancelled') THEN 'none'");
    expect(st).toContain("THEN CASE WHEN j.stripe_session_id IS NOT NULL AND COALESCE(j.payment_status, 'unpaid') <> 'abandoned' THEN 'paying' WHEN j.payment_status = 'failed' THEN 'job_stuck' ELSE 'job_open' END ELSE 'booked'");
    expect(st).toContain("WHEN m.hold IN ('none', 'job_open', 'job_stuck') AND m.status = 'ended' THEN 'unpaid'");
    // Lock order: items, then jobs, then link rows (no deadlock with undo).
    expect(flat(body("declutter_link_haul_away"))).toMatch(/ORDER BY i\.id FOR UPDATE;[^]*?WHERE j\.id = p_job_id[^]*?FOR UPDATE/);
    expect(flat(MIG)).toContain("job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,");
    expect(flat(body("declutter_cancel_haul_away"))).toContain("BETWEEN 3 AND 12 THEN UPDATE public.declutter_items SET status = 'live'");
    expect(MIG).not.toMatch(/UPDATE\s+public\.jobs|DELETE\s+FROM\s+public\.jobs/i);
  });

  it("owner 2026-10-17 (morning Q3): a FULL refund of a finished, disputed or cancelled haul-away job puts its items back on sale, and never blocks the refund", () => {
    const trg = flat(body("declutter_haul_away_job_refunded"));
    expect(trg).not.toBe("");
    // Fires on the full-refund state of a job that is over (a live job stays fail-closed 'booked').
    expect(flat(MIG)).toContain("CREATE TRIGGER trg_declutter_haul_away_job_refunded AFTER UPDATE OF payment_status, status ON public.jobs FOR EACH ROW WHEN (NEW.payment_status = 'refunded' AND NEW.status IN ('completed', 'disputed', 'cancelled') AND (OLD.payment_status IS DISTINCT FROM NEW.payment_status OR OLD.status IS DISTINCT FROM NEW.status)) EXECUTE FUNCTION public.declutter_haul_away_job_refunded();");
    // The same undo as declutter_cancel_haul_away: the link goes; back to 'live' only from 'live' with 3-12 photos.
    expect(trg).toContain("DELETE FROM public.declutter_haul_aways WHERE item_id = r.item_id AND job_id = NEW.id;");
    expect(trg).toContain("IF v_status = 'ended' AND r.prior_status = 'live' AND (SELECT count(*) FROM public.declutter_item_photos ph WHERE ph.item_id = r.item_id) BETWEEN 3 AND 12 THEN UPDATE public.declutter_items SET status = 'live'");
    // Never blocks the money write: the work is a sub-block whose failure is recorded, not raised.
    expect(trg).toMatch(/BEGIN BEGIN FOR r IN [^]*? EXCEPTION WHEN OTHERS THEN PERFORM public\.log_cron_defect\( 'declutter_haul_away_job_refunded' \|\| CASE WHEN COALESCE\(\(to_jsonb\(NEW\) ->> 'is_seed'\)::boolean, false\) THEN '-seed' ELSE '' END, NEW\.id::text,/);
    // A lock wait fails as a caught 55P03 well before the 8s statement timeout WHEN OTHERS cannot catch.
    expect(trg).toContain("SET lock_timeout TO '1s'");
    expect(trg).not.toMatch(/RAISE\s+EXCEPTION/i);
    expect(flat(MIG)).toContain("REVOKE ALL ON FUNCTION public.declutter_haul_away_job_refunded() FROM PUBLIC, anon, authenticated;");
    // The undo's own rule agrees (the fallback if the trigger logged a failure), in the helper and the state read,
    // and comes BEFORE the completed -> 'hauled' line.
    const hold = flat(body(HELPER));
    const refunded = hold.indexOf("IF v_pay = 'refunded' AND v_status IN ('completed', 'disputed') THEN RETURN 'none'; END IF;");
    expect(refunded).toBeGreaterThan(0);
    expect(hold.indexOf("IF v_status = 'completed' THEN RETURN 'hauled';")).toBeGreaterThan(refunded);
    const st = flat(body("declutter_haul_away_state"));
    const stRefunded = st.indexOf("WHEN COALESCE(j.payment_status, 'unpaid') = 'refunded' AND j.status IN ('completed', 'disputed') THEN 'none'");
    expect(stRefunded).toBeGreaterThan(0);
    expect(st.indexOf("WHEN j.status = 'completed' THEN 'hauled'")).toBeGreaterThan(stRefunded);
  });

  it("no new money path: nothing here touches payments, payouts, refunds or Stripe", () => {
    expect(MIG).not.toMatch(/declutter_(orders|payouts|refunds|buyer_cards)|create-payment/i);
    // stripe_session_id is only READ (the hold rule); no Stripe object is named otherwise.
    expect(MIG.replace(/stripe_session_id/g, "")).not.toMatch(/stripe/i);
  });

  it("is not a source of the shared Helpr task module (H11) and is proven on the newest Declutter schema", () => {
    // An ordinary job (owner ask): no helpr_task_* call and no helpr_tasks write.
    expect(MIG).not.toMatch(/helpr_task/i);
    const proof = readFileSync(join(process.cwd(), "src/test/pglite/declutterHaulAway.pglite.mjs"), "utf8");
    expect(proof).toContain('"20261017052705_declutter_helpr_delivery.sql"');
    expect(proof).toContain('process.env.NEW_MIGRATION === "skip"');
  });

  it("re-review 2026-10-17 #1: re-linking the same items to the same job answers success BEFORE the job-state check (a funded job's retry is never refused)", () => {
    const b = flat(body("declutter_link_haul_away"));
    const early = b.indexOf("WHERE h.item_id = ANY (v_ids) AND h.job_id = p_job_id) = cardinality(v_ids)");
    const jobCheck = b.indexOf("RAISE EXCEPTION 'haul_away_job_not_found'");
    expect(early).toBeGreaterThan(0);
    expect(jobCheck).toBeGreaterThan(early);
    const block = b.slice(early, jobCheck);
    expect(block).toMatch(/THEN RETURN cardinality\(v_ids\); END IF;/);
    // Only the caller's own items and job; a NULL job id never matches.
    expect(b).toContain("IF p_job_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job_id AND j.customer_id = v_uid FOR UPDATE)");
    expect(b).toContain("JOIN public.declutter_items i ON i.id = h.item_id AND i.seller_id = v_uid");
    expect(block).toContain("AND NOT EXISTS (SELECT 1 FROM public.declutter_haul_aways h WHERE h.job_id = p_job_id AND NOT (h.item_id = ANY (v_ids)))");
    expect(b.indexOf("ORDER BY i.id FOR UPDATE;")).toBeLessThan(early);
  });

  it("re-review 2026-10-17 #2: a declined card's job is 'job_stuck' (its poster's DELETE policy refuses it), in the helper and the state read alike", () => {
    expect(flat(body(HELPER))).toContain("WHEN v_pay = 'failed' THEN 'job_stuck'");
    expect(flat(body("declutter_haul_away_state"))).toContain("WHEN j.payment_status = 'failed' THEN 'job_stuck'");
    // job_open stays exactly what the poster may delete (20260903055308): unpaid with no session, or abandoned.
    const policy = flat(readFileSync(join(MIG_DIR, "20260903055308_job_delete_excludes_live_checkout.sql"), "utf8"));
    expect(policy).toContain("(payment_status = 'unpaid' AND stripe_session_id IS NULL)");
    expect(policy).toContain("OR payment_status = 'abandoned'");
  });

  it("re-review 2026-10-17 #6: the proof runs only on main's and the Declutter stack's migrations; the allowlist reason states the early success", () => {
    const proof = readFileSync(join(process.cwd(), "src/test/pglite/declutterHaulAway.pglite.mjs"), "utf8");
    expect(proof).toContain('const onMain = migrationsAt("origin/main");');
    expect(proof).toMatch(/if \(foreign\.length > 0\) \{\n[^\n]*\n\s*process\.exit\(2\);/);
    expect(proof).toContain('"ls-tree", "--full-tree", "--name-only"');
    const allow = JSON.parse(readFileSync(join(process.cwd(), "scripts/ci/definer-exec-allowlist.json"), "utf8")) as Record<string, unknown>;
    const why = JSON.stringify(allow).match(/"declutter_link_haul_away\(uuid\[\], uuid\)":"([^"]+)"/)?.[1] ?? "";
    expect(why).toContain("when every one is already linked to p_job_id and that job is the caller's");
    expect(why).toContain("a NULL p_job_id matches none");
  });

  it("re-review 2026-10-17 #4: the put-back-on-sale sweep is ONE open item and a condition for the switch going to everyone", () => {
    const open = readFileSync(join(process.cwd(), "docs/OPEN.md"), "utf8").split("\n").filter((l) => /^- \[ \] \*\*Q\S* [A-Z]+ Declutter haul-away/.test(l));
    expect(open).toHaveLength(1);
    expect(open[0]).toContain("CONDITION FOR GOING LIVE: the declutter_haul_away switch stays testers-only until the put-back-on-sale sweep below is live on prod");
  });

  it("re-review 2026-10-17 #8 (/posts budget, Q178): nothing haul-away sits in the signed-in-shared chunk", () => {
    // Measured 2026-10-17, production vite build: /posts 362 KB gz with the haul-away copy and helpers in
    // shared modules, 361 (the Declutter stack alone) with them here. What keeps them out:
    const src = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
    const importsOf = (p: string) => [...src(p).matchAll(/(?:^|\n)\s*import\s+(type\s+)?[^;]*?from\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)/g)]
      .map((m) => ({ type: !!m[1], from: m[2] ?? m[3], dynamic: !!m[3] }));
    const screens = ["src/components/declutter/DeclutterHomeView.tsx", "src/components/declutter/DeclutterHaulAway.tsx"];
    const postJob = ["src/pages/post-job/useHaulAwayPrefill.ts", "src/pages/post-job/useJobSubmit.ts"];
    let seen = 0;
    // 1. The screens take only TYPES from ./haulAwayParam (the predicates come with the lazy ./haulAway).
    for (const f of screens) for (const i of importsOf(f)) {
      if (i.from === "@/lib/declutter/haulAwayParam") { seen++; expect(i.type, `${f} imports haulAwayParam at run time`).toBe(true); }
    }
    // 2. Post a Job loads exactly one haul-away module, lazily, and nothing a screen shares.
    for (const f of postJob) for (const i of importsOf(f)) {
      if (/declutter\//.test(i.from)) { seen++; expect(i, f).toEqual({ type: false, from: "@/lib/declutter/haulAway", dynamic: true }); }
    }
    // 3. ./haulAwayParam (lazy) shares nothing with ./haulAwayLink (the screen's).
    expect(importsOf("src/lib/declutter/haulAwayParam.ts").map((i) => i.from)).not.toContain("./haulAwayLink");
    // 4. The shared copy tables carry no haul-away words (they live in ./haulAwayErrors).
    for (const f of ["src/lib/lifecycleErrors.ts", "src/lib/declutter/errors.ts"]) expect(src(f), f).not.toMatch(/\bhaul_away_[a-z_]+\s*:/);
    expect(seen).toBeGreaterThan(3);
  });
});
