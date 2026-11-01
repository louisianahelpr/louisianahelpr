// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql |     IF OLD.category::text = 'declutter_help' AND NOT public.sell_for_me_listings_sent(OLD.id) THEN |     IF false THEN
// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql |   IF v_job.category::text = 'declutter_help' AND NOT public.sell_for_me_listings_sent(v_job.id) THEN |   IF false THEN
// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql |      WHERE l.job_id = _job_id AND l.helpr_id = v_helper AND l.sent_at IS NOT NULL | WHERE l.job_id = _job_id
// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql | REVOKE ALL ON TABLE public.declutter_listed_for_seller FROM PUBLIC, anon, authenticated; | GRANT SELECT ON TABLE public.declutter_listed_for_seller TO authenticated;
// @mutate supabase/functions/create-payment/index.ts |           if (sent !== true) throw new PublicError | if (false) throw new PublicError
// @mutate supabase/functions/create-payment/index.ts |           if (sentErr) { | if (false) {
// @mutate src/pages/jobs/appliedJobCard/steps/WorkingStep.tsx |           <ListForSellerPanel jobId={app.job_id} job={job} posterName={app.posterName} /> | {null}
// @mutate src/pages/jobs/appliedJobCard/steps/OnSiteStep.tsx |           <ListForSellerPanel jobId={app.job_id} job={job} posterName={app.posterName} /> | {null}
// @mutate src/components/declutter/DeclutterHomeView.tsx |       <ListedForYouCard /> | {null}
// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql | STABLE\nSECURITY DEFINER\nSET search_path TO 'public', 'pg_temp'\nAS $function$ | STABLE\nSECURITY DEFINER\nSET search_path TO 'public'\nAS $function$
// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql | IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  SELECT item_id INTO v_item | SELECT item_id INTO v_item
// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql | IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n  PERFORM public.declutter_list_for_seller_draft(p_item_id);\n  DELETE FROM | PERFORM public.declutter_list_for_seller_draft(p_item_id);\n  DELETE FROM
// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql | title text, price_cents integer, floor_price_cents integer, | title text, price_cents integer,
// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql | THEN pv.floor_price_cents END, | THEN pv.floor_price_cents ELSE pv.floor_price_cents END,
// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql |                  AND j.status::text IN ('accepted', 'in_progress', 'revision_requested')\n | 
// @mutate supabase/migrations/20261101054258_declutter_photo_purge.sql |   v_link record;\nBEGIN\n  PERFORM public.require_feature('declutter');\n  IF public.is_caller_banned() THEN\n    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';\n  END IF;\n |   v_link record;\nBEGIN\n  PERFORM public.require_feature('declutter');\n
//
// LEAD-LIST-FOR-SELLER (owner 10-31 ~10:30 PM, POST-H3; lead decision): a "Have a Helpr list it" job is done for the
// Helpr once they have SENT its listings to the seller for approval (never stranded waiting for the seller). Mark done
// has three doors and all three must ask the same rule: the jobs trigger (authoritative), rpc_helper_mark_done (the
// clean refusal), and create-payment's release path (a service-role write the trigger's caller check skips), which
// must fail CLOSED on an error. The link table that says who wrote a listing is private.
// Behaviour under real roles: src/test/pglite/declutterListForSeller.pglite.mjs (NEW_MIGRATION=skip red).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG);
const body = (n: string) => blankSqlComments(DEFS.get(n)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

/** Every migration statement on the link table's grants, comment-blanked, in order. */
function linkTableGrants(): string[] {
  const out: string[] = [];
  for (const f of readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(resolve(MIG, f), "utf8"));
    for (const m of sql.matchAll(/(?:GRANT|REVOKE)[^;]*ON\s+TABLE\s+public\.declutter_listed_for_seller[^;]*;/gi)) out.push(flat(m[0]));
  }
  return out;
}

/** The list-for-seller migration names WHICH functions are graded; their text is always the newest definition. */
const LFS = `supabase/migrations/${readdirSync(MIG).find((n) => n.endsWith("_declutter_list_for_seller.sql"))}`;

const FN_RE = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\(([\s\S]*?)\bAS\s+(\$\w*\$)([\s\S]*?)\3/gi;

/**
 * Each function this migration creates: its name, and the header (up to AS) and body of its NEWEST definition
 * (a later migration may restate it: 20261101054258 restates declutter_decline_listed_for_me). Comment-blanked.
 */
function lfsFunctions(): { name: string; head: string; body: string }[] {
  const sql = blankSqlComments(readFileSync(resolve(ROOT, LFS), "utf8"));
  const out: { name: string; head: string; body: string }[] = [];
  for (const m of sql.matchAll(FN_RE)) {
    const newest = [...body(m[1]).matchAll(FN_RE)][0] ?? m;
    out.push({ name: m[1], head: flat(newest[2]), body: newest[4] });
  }
  return out;
}

describe("the list-for-seller functions (lh-authz-rls review, 11-01)", () => {
  const fns = lfsFunctions();
  it("every SECURITY DEFINER sets a search_path that ends in pg_temp", () => {
    const definers = fns.filter((f) => /\bSECURITY DEFINER\b/i.test(f.head));
    expect(definers.length).toBeGreaterThan(12);
    expect(definers.filter((f) => !/SET search_path TO 'public', 'pg_temp'/.test(f.head)).map((f) => f.name)).toEqual([]);
  });
  it("every Helpr write, and the seller's approve and decline, refuses a banned caller", () => {
    const writes = fns.filter((f) => /^declutter_helpr_(create|update|add|remove|delete|send)_|^declutter_(approve|decline)_listed_for_me$/.test(f.name));
    expect(writes.length).toBeGreaterThan(7);
    expect(writes.filter((f) => !/IF public\.is_caller_banned\(\) THEN\s+RAISE EXCEPTION 'account_restricted'/.test(f.body)).map((f) => f.name)).toEqual([]);
  });
  it("the Helpr reads the hidden lowest price only while writing it, on an open job", () => {
    const f = fns.find((x) => x.name === "declutter_helpr_job_listings");
    expect(flat(f?.body ?? "")).toContain("CASE WHEN i.status IN ('draft', 'pending_seller_approval') AND j.status::text IN ('accepted', 'in_progress', 'revision_requested') THEN pv.floor_price_cents END");
    expect(flat(f?.body ?? "").match(/pv\.floor_price_cents/g)?.length).toBe(1);
  });
  it("the seller's approval card returns the lowest price the Helpr set", () => {
    const f = fns.find((x) => x.name === "declutter_listed_for_me");
    expect(f?.head).toMatch(/floor_price_cents integer/);
    expect(flat(f?.body ?? "")).toMatch(/pv\.floor_price_cents, .*LEFT JOIN public\.declutter_item_private pv ON pv\.item_id = l\.item_id/);
  });
});

describe("a Have a Helpr list it job is done once its listings are sent", () => {
  it("the jobs trigger and rpc_helper_mark_done both ask sell_for_me_listings_sent for declutter_help", () => {
    const doors = ["enforce_helper_completion_gates", "rpc_helper_mark_done"];
    for (const d of doors) {
      expect(body(d), d).toMatch(/category::text = 'declutter_help' AND NOT public\.sell_for_me_listings_sent\((OLD|v_job)\.id\) THEN\s+RAISE EXCEPTION 'completion_requires_listings_sent'/);
      expect(body(d), `${d} must not keep the replaced done-when-live gate`).not.toMatch(/sell_for_me_listings_live/);
    }
    expect(doors.filter((d) => DEFS.has(d)).length).toBeGreaterThan(1);
  });

  it("sent means a listing of THIS job, by its Helpr, actually sent", () => {
    const b = flat(body("sell_for_me_listings_sent"));
    expect(b).toContain("WHERE l.job_id = _job_id AND l.helpr_id = v_helper AND l.sent_at IS NOT NULL");
    expect(b).toContain("auth.uid() IS DISTINCT FROM v_helper AND auth.uid() IS DISTINCT FROM v_seller");
  });

  it("create-payment's release path asks the same rule and fails closed", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "supabase/functions/create-payment/index.ts"), "utf8"));
    const gate = src.slice(src.indexOf("const newHelperCompletionGates"), src.indexOf("if (isHelper && !isPoster && !job.helper_completed_at) await newHelperCompletionGates(job);"));
    expect(gate.length).toBeGreaterThan(200);
    expect(gate).toMatch(/job\.category === "declutter_help"/);
    expect(gate).toMatch(/supabaseAdmin\.rpc\("sell_for_me_listings_sent", \{ _job_id: jobId \}\)/);
    expect(gate).toMatch(/if \(sentErr\) \{[\s\S]*?throw new PublicError/);
    expect(gate).toMatch(/if \(sent !== true\) throw new PublicError/);
  });

  it("who wrote a listing stays private: no client grant on the link table", () => {
    const g = linkTableGrants();
    expect(g.length).toBeGreaterThan(1);
    expect(g.some((s) => /^REVOKE ALL ON TABLE public\.declutter_listed_for_seller FROM PUBLIC, anon, authenticated;$/i.test(s))).toBe(true);
    expect(g.filter((s) => /^GRANT/i.test(s) && /\bTO\b[^;]*\b(authenticated|anon|PUBLIC)\b/.test(s))).toEqual([]);
  });

  it("both halves are mounted: the Helpr's panel on the on-site and working steps, the seller's card on Selling", () => {
    const src = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));
    const steps = ["src/pages/jobs/appliedJobCard/steps/WorkingStep.tsx", "src/pages/jobs/appliedJobCard/steps/OnSiteStep.tsx"];
    for (const f of steps) expect(src(f), f).toMatch(/<ListForSellerPanel jobId=\{app\.job_id\} job=\{job\} posterName=\{app\.posterName\} \/>/);
    expect(steps.length).toBeGreaterThan(1);
    const home = src("src/components/declutter/DeclutterHomeView.tsx");
    expect(home.slice(home.indexOf("function SellingView"))).toMatch(/<ListedForYouCard \/>/);
  });
});
