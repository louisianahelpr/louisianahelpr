/**
 * GUARD: Declutter "Add a Helpr" (owner 2026-10-16; docs/specs/declutter-add-a-helpr.md).
 *
 * The add-on must stay an ordinary Helpr job: Post a Job opens pre-filled from
 * the paid order, the buyer pays through the normal job checkout, and only the
 * LINK is new. This checks every layer that makes that true:
 *   - SQL (20261017073146): both functions refuse without the hidden switch,
 *     act only for the order's buyer and the caller's own open job, anon cannot call them, and no client role touches the link
 *     table; the switch is born 'testers'. Its PGlite proof
 *     (src/test/pglite/declutterAddAHelpr.pglite.mjs) runs every rule on a
 *     prod-shaped world, red without the migration (`NEW_MIGRATION=skip`: 0/20, exit 1, measured 2026-10-16),
 *     and a second stage on the REAL Declutter schema with Helpr delivery applied
 *     (a paid delivery order is offered too).
 *   - Post a Job: `?declutterOrder=` skips the entry screen, pre-fills, and the
 *     new job is linked right after it is created (useJobSubmit).
 *   - Declutter: the buyer's paid order card offers the three choices behind
 *     the switch, each opening Post a Job.
 *   - No payment call: nothing in the feature calls a payment function.
 *   - A10 (owner, 2026-10-17): a seller-fault Declutter refund cancels the buyer's setup job with no fee and
 *     no strike (trg_declutter_refund_cancels_setup_jobs); void-cancelled-payments reads the marker, refunds
 *     the job in full (setup fee kept) and bills the card fee to the seller (declutter_setup_job_fee_debt);
 *     proven in PGlite A1-A10 and src/test/edge/void-cancelled-payments.declutterSellerFault.test.ts.
 *
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |    WHERE id = p_order_id AND buyer_id = v_uid; |    WHERE id = p_order_id;
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |    WHERE j.id = p_job_id AND j.customer_id = v_uid AND j.status = 'open' |    WHERE j.id = p_job_id AND j.status = 'open'
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |   IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n | \n
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |   IF COALESCE(v_payment, 'unpaid') NOT IN ('unpaid', 'abandoned', 'failed') THEN |   IF v_payment IN ('escrow', 'payout_pending', 'released') THEN
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |               WHERE l.job_id = p_job_id AND l.order_id = p_order_id\n                FOR SHARE) THEN\n    RETURN true; |               WHERE false) THEN\n    RETURN true;
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |                     AND NOT public.declutter_seller_out(o.seller_id) |                     AND true
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |      OR public.declutter_seller_out(o.seller_id) THEN |      OR false THEN
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |   v_payment text;\nBEGIN\n  PERFORM public.require_feature('declutter');\n |   v_payment text;\nBEGIN\n
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |   o public.declutter_orders;\nBEGIN\n  PERFORM public.require_feature('declutter');\n |   o public.declutter_orders;\nBEGIN\n
 * @mutate scripts/ci/null-arg-validators.sql |   ('declutter_link_setup_job',      'action', |   ('declutter_link_setup_job',      'allow',
 * @mutate scripts/ci/null-arg-validators.sql | links the caller''s own open, not-yet-paid job (any category) | links the caller''s own open assembly/handyman job
 * @mutate src/integrations/supabase/types.ts |       declutter_order_jobs: {\n        Row: {\n          created_at: string\n          job_id: string\n |       declutter_order_jobs: {\n        Row: {\n          created_at: string\n
 * @mutate src/test/pglite/declutterAddAHelpr.pglite.mjs |   if (refs.length === 0 \|\| bad.length) { |   if (false) {
 * @mutate src/pages/post-job/useJobSubmit.ts |     description: why ?? "Find it under your posted jobs.", |     description: "Find it under your posted jobs.",
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql | REVOKE ALL ON FUNCTION public.declutter_link_setup_job(uuid, uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_link_setup_job(uuid, uuid) FROM PUBLIC;
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql | VALUES ('declutter_add_helpr', 'testers', | VALUES ('declutter_add_helpr', 'off',
 * @mutate src/pages/post-job/usePostJobForm.ts |  \|\| searchParams.get("declutterOrder") |
 * @mutate src/pages/post-job/useJobSubmit.ts |     if (!(await linkSetupJob(orderId, jobId))) linkErr |     if (false) linkErr
 * @mutate src/pages/post-job/useJobSubmit.ts |       if (declutterOrderId) await linkSetupJobOrTell(declutterOrderId, attempt.jobId); |
 * @mutate src/pages/post-job/useJobSubmit.ts |       if (!declutterOrderId) { |       if (true) {
 * @mutate src/pages/post-job/useJobSubmit.ts |   toast.error("Your job posted, but it isn't showing on your Declutter purchase", { |   void ("Your job posted, but it isn't showing on your Declutter purchase", {
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |   WHEN (NEW.fee_policy = 'full_seller_pays_fee') |   WHEN (NEW.fee_policy IS NOT NULL)
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |              cancellation_fee = 0, |              cancellation_fee = 20,
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |       PERFORM set_config('app.sanctioned_cancel', v_prev, true);\n      UPDATE public.declutter_order_jobs |       PERFORM set_config('app.sanctioned_cancel', v_prev, true);\n      PERFORM public.apply_cancellation_violation_consequence(r.job_id);\n      UPDATE public.declutter_order_jobs
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |       IF rf.reason = 'seller_no_show' AND j.committed AND NOT p_include_committed THEN |       IF false THEN
 * @mutate supabase/migrations/20261017073146_declutter_add_a_helpr.sql |   IF l.seller_fee_billed_cents IS NOT NULL THEN\n    RETURN 0; |   IF false THEN\n    RETURN 0;
 * @mutate supabase/functions/void-cancelled-payments/index.ts |           .select("seller_fault_refund_id") |           .select("id")
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {order.side === "buyer" && <Suspense fallback={null}><AddHelprPanel orderId={order.orderId} /></Suspense>} |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const code = (p: string) => blankComments(read(p));
const MIGRATION = "supabase/migrations/20261017073146_declutter_add_a_helpr.sql";

/** One function's body from the migration (dollar tag $fn$). */
function fnBody(sql: string, name: string): string {
  const at = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(at, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("$fn$", at);
  return sql.slice(open, sql.indexOf("$fn$;", open + 4));
}

describe("Declutter Add a Helpr", () => {
  const sql = blankSqlComments(read(MIGRATION));

  it("the switch is created as testers and both functions refuse without it, first", () => {
    expect(sql).toMatch(/VALUES \('declutter_add_helpr', 'testers',/);
    expect(sql).toContain("ON CONFLICT (key) DO NOTHING;");
    const fns = ["declutter_setup_helpr", "declutter_link_setup_job"];
    expect(fns.length).toBeGreaterThan(1);
    for (const fn of fns) {
      const body = fnBody(sql, fn);
      expect(body.indexOf("PERFORM public.require_feature('declutter_add_helpr');"), fn).toBeGreaterThan(0);
      expect(body.indexOf("PERFORM public.require_feature('declutter_add_helpr');")).toBeLessThan(body.indexOf("IF v_uid IS NULL"));
    }
  });

  it("both functions also refuse when Declutter's own switch is off, first, as every Declutter RPC does (authz review B)", () => {
    // The house pattern on the stack: helpr_set_vehicle (its NEWEST definition) starts
    // PERFORM public.require_feature('declutter'); before its uid check.
    const house = effectiveDefs(resolve(ROOT, "supabase/migrations")).get("helpr_set_vehicle")?.stmt ?? "";
    expect(house).toMatch(/helpr_set_vehicle[\s\S]*?BEGIN\n {2}PERFORM public\.require_feature\('declutter'\);\n {2}IF v_uid IS NULL/);
    for (const fn of ["declutter_setup_helpr", "declutter_link_setup_job"]) {
      const body = fnBody(sql, fn);
      const dc = body.indexOf("PERFORM public.require_feature('declutter');");
      expect(dc, fn).toBeGreaterThan(0);
      expect(dc, fn).toBeLessThan(body.indexOf("PERFORM public.require_feature('declutter_add_helpr');"));
      expect(body.slice(body.indexOf("BEGIN"), dc), `${fn}: nothing before the switch`).not.toMatch(/SELECT|INSERT|UPDATE|DELETE|RAISE/);
    }
  });

  it("the link refuses a banned caller before it reads anything, and a job that is already paid for (authz B, money D)", () => {
    const link = fnBody(sql, "declutter_link_setup_job");
    const ban = link.indexOf("IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';");
    expect(ban).toBeGreaterThan(link.indexOf("IF v_uid IS NULL"));
    expect(ban).toBeLessThan(link.indexOf("FROM public.jobs j\n   WHERE"));
    expect(link).toMatch(/SELECT j\.payment_status INTO v_payment FROM public\.jobs j\n {3}WHERE j\.id = p_job_id AND j\.customer_id = v_uid AND j\.status = 'open'\n {3}FOR SHARE;/);
    // An ALLOWLIST of never-paid states (money review of 4f45a073f #3).
    expect(link).toMatch(/IF COALESCE\(v_payment, 'unpaid'\) NOT IN \('unpaid', 'abandoned', 'failed'\) THEN\n {4}RAISE EXCEPTION 'job_already_funded'/);
    // A job already linked to THIS order answers yes before the job-state checks (review #4: a retry after a lost answer).
    expect(link.indexOf("WHERE l.job_id = p_job_id AND l.order_id = p_order_id\n                FOR SHARE) THEN\n    RETURN true;")).toBeGreaterThan(ban);
    expect(link.indexOf("WHERE l.job_id = p_job_id AND l.order_id = p_order_id\n                FOR SHARE) THEN")).toBeLessThan(link.indexOf("FROM public.jobs j\n   WHERE j.id = p_job_id AND j.customer_id = v_uid AND j.status = 'open'"));
    // A seller who can no longer sell: no offer, no link (review #2).
    expect(link).toContain("AND NOT public.declutter_seller_out(o.seller_id)");
    expect(fnBody(sql, "declutter_setup_helpr")).toContain("OR public.declutter_seller_out(o.seller_id) THEN");
    expect(link.indexOf("job_already_funded")).toBeLessThan(link.indexOf("INSERT INTO public.declutter_order_jobs"));
    // The pre-fill read is STABLE: the ban-gate class check (Q281) covers VOLATILE functions only.
    expect(sql).toMatch(/FUNCTION public\.declutter_setup_helpr\(p_order_id uuid\)\nRETURNS jsonb\nLANGUAGE plpgsql\nSTABLE/);
  });

  it("the client has words for every refusal the link can give, and shows them when it fails", async () => {
    const { RPC_ERROR_COPY } = await import("@/lib/lifecycleErrors");
    const copy = RPC_ERROR_COPY.declutter_link_setup_job as Record<string, string>;
    const raised = [...fnBody(sql, "declutter_link_setup_job").matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((m) => m[1]);
    expect(raised.length).toBeGreaterThan(2);
    const all = [...new Set([...raised, "feature_disabled"])].sort();
    for (const c of all) expect(copy[c], c).toBeTruthy();
    expect(Object.keys(copy).sort()).toEqual(all);
    expect(code("src/pages/post-job/useJobSubmit.ts")).toMatch(/const why = \(linkErr as \{ userMessage\?: string \} \| null\)\?\.userMessage;[\s\S]*?description: why \?\? "Find it under your posted jobs\.",/);
  });

  it("the null-argument class check calls the link an action and says what it really links (C)", () => {
    const row = read("scripts/ci/null-arg-validators.sql").split("\n").find((l) => l.includes("('declutter_link_setup_job',"));
    expect(row).toBeDefined();
    expect(row).toMatch(/^ {2}\('declutter_link_setup_job', +'action', +'VOLATILE: /);
    expect(row, "no category gate (silent-failure review #1)").toContain("(any category)");
    expect(row).toContain("not-yet-paid");
    expect(row).toContain("20261017073146");
    // The NULL behaviour it states is measured by H18 of the PGlite proof.
    expect(row).toContain("a NULL job matches no job and raises not your open job, a NULL order matches no order and answers FALSE");
    expect(read("src/test/pglite/declutterAddAHelpr.pglite.mjs")).toContain('check("H18 NULL arguments never link');
  });

  it("types.ts declares the link table with the migration's columns (authz review A)", () => {
    const types = read("src/integrations/supabase/types.ts");
    const at = types.indexOf("      declutter_order_jobs: {\n        Row: {");
    expect(at).toBeGreaterThan(0);
    const row = types.slice(at, types.indexOf("\n        }", at));
    const cols = [...row.matchAll(/^ {10}([a-z_]+): /gm)].map((m) => m[1]).sort();
    const start = sql.indexOf("CREATE TABLE IF NOT EXISTS public.declutter_order_jobs (");
    const table = sql.slice(start, sql.indexOf(");", start));
    // Plus A10's marker columns (ALTER TABLE ... ADD COLUMN IF NOT EXISTS).
    const alterAt = sql.indexOf("ALTER TABLE public.declutter_order_jobs\n  ADD COLUMN");
    expect(alterAt).toBeGreaterThan(0);
    const alter = sql.slice(alterAt, sql.indexOf(";", alterAt));
    const added = [...alter.matchAll(/ADD COLUMN IF NOT EXISTS ([a-z_]+) /g)].map((m) => m[1]);
    expect(added.length).toBe(3);
    const sqlCols = [...[...table.matchAll(/^ {2}([a-z_]+) (uuid|text|timestamptz)/gm)].map((m) => m[1]), ...added].sort();
    expect(sqlCols.length).toBeGreaterThan(3);
    expect(cols).toEqual(sqlCols);
  });

  it("the migration is newer than the Declutter stack's newest, and its proof loads only main + stack migrations (E)", () => {
    const stamp = MIGRATION.match(/\/(\d{14})_/)?.[1] ?? "";
    expect(stamp > "20261017060455", "newer than the stack's newest (declutter_seller_out_pays_fee)").toBe(true);
    const proof = read("src/test/pglite/declutterAddAHelpr.pglite.mjs");
    expect(proof).toContain('process.env.BASE_REFS ?? "origin/main origin/ready/declutter-stack"');
    expect(proof).toMatch(/if \(refs\.length === 0 \|\| bad\.length\) \{\n {4}console\.log\(`PRECONDITION FAILED[^\n]*\n {4}process\.exit\(1\);/);
  });

  it("acts only for the order's buyer and the caller's own open job", () => {
    expect(fnBody(sql, "declutter_setup_helpr")).toMatch(/WHERE id = p_order_id AND buyer_id = v_uid;/);
    expect(fnBody(sql, "declutter_setup_helpr")).toMatch(/WHERE l\.order_id = o\.id AND j\.customer_id = v_uid/);
    const link = fnBody(sql, "declutter_link_setup_job");
    expect(link).toMatch(/WHERE j\.id = p_job_id AND j\.customer_id = v_uid AND j\.status = 'open'/);
    expect(link, "no category gate: a re-picked category must still link (silent-failure review #1)").not.toMatch(/j\.category/);
    expect(link).toMatch(/WHERE o\.id = p_order_id AND o\.buyer_id = v_uid/);
  });

  it("anon cannot call either function and no client role touches the link table", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_setup_helpr(uuid) FROM PUBLIC, anon;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_link_setup_job(uuid, uuid) FROM PUBLIC, anon;");
    expect(sql).toContain("REVOKE ALL ON TABLE public.declutter_order_jobs FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/GRANT [A-Z, ]+ ON TABLE public\.declutter_order_jobs TO [a-z_, ]*authenticated/);
    expect(sql, "an unpaid orphan job must stay deletable").toContain("REFERENCES public.jobs(id) ON DELETE CASCADE");
  });

  it("its PGlite proof covers every rule and expects all of them", () => {
    const proof = read("src/test/pglite/declutterAddAHelpr.pglite.mjs");
    const labels = ["H1 ", "H2 ", "H3 ", "H4 ", "H5 ", "H6 ", "H7 ", "H8 ", "H9 ", "H10 ", "H11 ", "H12 ", "H13 ", "H14 ",
      "H15 ", "H16 ", "H17 ", "H18 ", "H19 ", "H20 ", "H21 ", "P1 ", "P2 ", "P3 ", "P4 ", "P5 ", "P6 ",
      "A1 ", "A2 ", "A3 ", "A4 ", "A5 ", "A6 ", "A7 ", "A8 ", "A9 ", "A10 ", "A11 ", "A12 ", "A13 ", "A14 ", "A15 ", "A16 ", "A17 ", "A17b ", "A18 "];
    expect(labels.length).toBeGreaterThan(10);
    for (const l of labels) expect(proof).toContain(`check("${l}`);
    expect(proof).toContain(`const expected = ${labels.length};`);
    expect(proof).toContain('const THIS = "20261017073146_declutter_add_a_helpr.sql";');
    // Stage 2 runs on the newest Declutter schema, Helpr delivery and the seller-pays-fee refund rule
    // (the newest declutter_record_refund, which fires A10's trigger) included.
    expect(proof).toContain('"20261017060455_declutter_seller_out_pays_fee.sql"');
    expect(proof).toContain('process.env.NEW_MIGRATION === "skip"');
  });

  it("Post a Job opens the order pre-filled, skips the entry screen, and links the new job", () => {
    expect(code("src/pages/post-job/usePostJobForm.ts")).toContain('|| searchParams.get("declutterOrder") ||');
    expect(code("src/pages/post-job/usePostJobForm.ts")).toContain('declutterOrderId: searchParams.get("declutterOrder"),');
    expect(code("src/pages/post-job/useJobFormEffects.ts")).toMatch(/searchParams\.get\("declutterOrder"\)[\s\S]*?fetchSetupHelpr\(orderId\)[\s\S]*?buildSetupJobPrefill\(/);
    const submit = code("src/pages/post-job/useJobSubmit.ts");
    expect(submit).toContain("if (!(await linkSetupJob(orderId, jobId))) linkErr = ");
    expect(submit).toContain("if (declutterOrderId) await linkSetupJobOrTell(declutterOrderId, jobData.id);");
    // The retry of a lost payment answer links again first (money review of 4f45a073f #4) ...
    expect(submit).toMatch(/if \(attempt\.jobId\) \{[\s\S]*?if \(declutterOrderId\) await linkSetupJobOrTell\(declutterOrderId, attempt\.jobId\);[\s\S]*?await startPayment\(attempt\.jobId/);
    // ... and a setup job never keeps a draft (it cannot carry its order).
    expect(submit).toMatch(/if \(!declutterOrderId\) \{\n\s*flushDraft\(\);/);
    // A failed link is told to the buyer, not only logged (lh-silent-failure review #1).
    expect(submit).toMatch(/if \(!linkErr\) return;[\s\S]*?toast\.error\("Your job posted, but it isn't showing on your Declutter purchase"/);
  });

  it("the buyer's paid order card offers the choices behind the switch, each opening Post a Job", () => {
    expect(code("src/components/declutter/DeclutterHandoverViews.tsx")).toContain('{order.side === "buyer" && <Suspense fallback={null}><AddHelprPanel orderId={order.orderId} /></Suspense>}');
    // Loaded with the buyer's order card only (Q178: off /posts' critical path).
    expect(code("src/components/declutter/DeclutterHandoverViews.tsx")).toContain('const AddHelprPanel = lazy(() => import("./DeclutterAddHelpr")');
    const panel = code("src/components/declutter/DeclutterAddHelpr.tsx");
    expect(panel).toContain('const on = useFeature("declutter_add_helpr");');
    expect(panel).toContain("if (!on) return null;");
    expect(panel).toContain("to={`/post-job?declutterOrder=${encodeURIComponent(orderId)}&help=${k}`}");
  });

  it("adds no payment call: nothing in the feature calls a payment function", () => {
    // Code only (comments blanked): A10's comments name Stripe's card fee, its code calls nothing that pays.
    const files: Array<[string, string]> = [[MIGRATION, sql], ["src/lib/declutter/setupHelpr.ts", code("src/lib/declutter/setupHelpr.ts")],
      ["src/components/declutter/DeclutterAddHelpr.tsx", code("src/components/declutter/DeclutterAddHelpr.tsx")]];
    expect(files.length).toBeGreaterThan(2);
    for (const [f, text] of files) {
      expect(text, f).not.toMatch(/stripe|create-payment|declutter_start_checkout|declutter-checkout|transfer/i);
    }
  });

  // A10 (owner rule, 2026-10-17): a seller-fault Declutter refund cancels the buyer's setup job, no fee, no strike;
  // the job comes back in full (void-cancelled-payments) and the card fee is the seller's debt.
  it("A10: only a seller-fault refund cancels the setup job, with no fee and no strike, never blocking the refund", () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_declutter_refund_cancels_setup_jobs\s+AFTER INSERT ON public\.declutter_refunds\s+FOR EACH ROW\s+WHEN \(NEW\.fee_policy = 'full_seller_pays_fee'\)/);
    // The trigger only calls the worker, inside its own catch-all (the refund write must land).
    expect(fnBody(sql, "declutter_refund_cancels_setup_jobs")).toMatch(/PERFORM public\.declutter_apply_seller_fault\(NEW\.id, false\);\s+EXCEPTION WHEN OTHERS THEN/);
    const body = fnBody(sql, "declutter_apply_seller_fault");
    expect(body).toContain("cancellation_fee = 0,");
    expect(body).toContain("late_cancellation = false,");
    expect(body).toContain("SET seller_fault_refund_id = rf.id");
    // A buyer-asserted no-show never cancels a committed Helpr's job fee-free (lh-authz-rls review of c57d948d0 #1).
    expect(body).toContain("IF rf.reason = 'seller_no_show' AND j.committed AND NOT p_include_committed THEN");
    expect(fnBody(sql, "declutter_admin_apply_seller_fault")).toContain("public.has_role(v_uid, 'admin'::app_role)");
    expect(body).not.toMatch(/apply_cancellation_violation_consequence|declutter_give_strike/);
    expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN\s+PERFORM public\.log_cron_defect\(v_src, r\.job_id::text,/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.declutter_setup_job_fee_debt(uuid, integer) FROM PUBLIC, anon, authenticated;");
    const debt = fnBody(sql, "declutter_setup_job_fee_debt");
    expect(debt).toContain("IF l.seller_fee_billed_cents IS NOT NULL THEN\n    RETURN 0;");
    // The sweep reads the marker and prices a marked job at no fee and no card fee kept.
    const vcp = code("supabase/functions/void-cancelled-payments/index.ts");
    expect(vcp).toContain('.select("seller_fault_refund_id")');
    expect(vcp).toContain("jobCancellationFee = sellerFault || refundsSeriesVisitInFull(job) ? 0 : computeCancellationFee(job);");
    expect(vcp).toContain('supabaseAdmin.rpc("declutter_setup_job_fee_debt", {');
  });
});
