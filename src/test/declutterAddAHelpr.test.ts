/**
 * GUARD: Declutter "Add a Helpr" (owner 2026-10-16; docs/specs/declutter-add-a-helpr.md).
 *
 * The add-on must stay an ordinary Helpr job: Post a Job opens pre-filled from
 * the paid order, the buyer pays through the normal job checkout, and only the
 * LINK is new. This checks every layer that makes that true:
 *   - SQL (20261016053527): both functions refuse without the hidden switch,
 *     act only for the order's buyer and the caller's own open job, anon cannot call them, and no client role touches the link
 *     table; the switch is born 'testers'. Its PGlite proof
 *     (src/test/pglite/declutterAddAHelpr.pglite.mjs) runs every rule on a
 *     prod-shaped world, red without the migration (`--before`, 0/14 measured 2026-10-16).
 *   - Post a Job: `?declutterOrder=` skips the entry screen, pre-fills, and the
 *     new job is linked right after it is created (useJobSubmit).
 *   - Declutter: the buyer's paid order card offers the three choices behind
 *     the switch, each opening Post a Job.
 *   - No new money path: nothing in the feature calls a payment function.
 *
 * @mutate supabase/migrations/20261016053527_declutter_add_a_helpr.sql |    WHERE id = p_order_id AND buyer_id = v_uid; |    WHERE id = p_order_id;
 * @mutate supabase/migrations/20261016053527_declutter_add_a_helpr.sql |                   WHERE j.id = p_job_id AND j.customer_id = v_uid AND j.status = 'open' |                   WHERE j.id = p_job_id AND j.status = 'open'
 * @mutate supabase/migrations/20261016053527_declutter_add_a_helpr.sql | REVOKE ALL ON FUNCTION public.declutter_link_setup_job(uuid, uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_link_setup_job(uuid, uuid) FROM PUBLIC;
 * @mutate supabase/migrations/20261016053527_declutter_add_a_helpr.sql | VALUES ('declutter_add_helpr', 'testers', | VALUES ('declutter_add_helpr', 'off',
 * @mutate src/pages/post-job/usePostJobForm.ts |  \|\| searchParams.get("declutterOrder") |
 * @mutate src/pages/post-job/useJobSubmit.ts |         if (!(await linkSetupJob(declutterOrderId, jobData.id))) linkErr |         if (false) linkErr
 * @mutate src/pages/post-job/useJobSubmit.ts |         toast.error("Your job posted, but it isn't showing on your Declutter purchase", { |         void ("Your job posted, but it isn't showing on your Declutter purchase", {
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {order.side === "buyer" && <AddHelprPanel orderId={order.orderId} />} |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const code = (p: string) => blankComments(read(p));
const MIGRATION = "supabase/migrations/20261016053527_declutter_add_a_helpr.sql";

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
    const labels = ["H1 ", "H2 ", "H3 ", "H4 ", "H5 ", "H6 ", "H7 ", "H8 ", "H9 ", "H10 ", "H11 ", "H12 ", "H13 ", "H14 "];
    expect(labels.length).toBeGreaterThan(10);
    for (const l of labels) expect(proof).toContain(`check("${l}`);
    expect(proof).toContain(`const expected = ${labels.length};`);
    expect(proof).toContain('const THIS = "20261016053527_declutter_add_a_helpr.sql";');
  });

  it("Post a Job opens the order pre-filled, skips the entry screen, and links the new job", () => {
    expect(code("src/pages/post-job/usePostJobForm.ts")).toContain('|| searchParams.get("declutterOrder") ||');
    expect(code("src/pages/post-job/usePostJobForm.ts")).toContain('declutterOrderId: searchParams.get("declutterOrder"),');
    expect(code("src/pages/post-job/useJobFormEffects.ts")).toMatch(/searchParams\.get\("declutterOrder"\)[\s\S]*?fetchSetupHelpr\(orderId\)[\s\S]*?buildSetupJobPrefill\(/);
    const submit = code("src/pages/post-job/useJobSubmit.ts");
    expect(submit).toContain("if (!(await linkSetupJob(declutterOrderId, jobData.id))) linkErr = ");
    // A failed link is told to the buyer, not only logged (lh-silent-failure review #1).
    expect(submit).toMatch(/if \(linkErr\) \{[\s\S]*?toast\.error\("Your job posted, but it isn't showing on your Declutter purchase"/);
  });

  it("the buyer's paid order card offers the choices behind the switch, each opening Post a Job", () => {
    expect(code("src/components/declutter/DeclutterHandoverViews.tsx")).toContain('{order.side === "buyer" && <AddHelprPanel orderId={order.orderId} />}');
    const panel = code("src/components/declutter/DeclutterAddHelpr.tsx");
    expect(panel).toContain('const on = useFeature("declutter_add_helpr");');
    expect(panel).toContain("if (!on) return null;");
    expect(panel).toContain("to={`/post-job?declutterOrder=${encodeURIComponent(orderId)}&help=${k}`}");
  });

  it("adds no money path: nothing in the feature calls a payment function", () => {
    const files = [MIGRATION, "src/lib/declutter/setupHelpr.ts", "src/components/declutter/DeclutterAddHelpr.tsx"];
    expect(files.length).toBeGreaterThan(2);
    for (const f of files) {
      expect(read(f), f).not.toMatch(/stripe|create-payment|declutter_start_checkout|declutter-checkout|transfer/i);
    }
  });
});
