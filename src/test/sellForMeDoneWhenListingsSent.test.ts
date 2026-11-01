// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql |     IF OLD.category::text = 'declutter_help' AND NOT public.sell_for_me_listings_sent(OLD.id) THEN |     IF false THEN
// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql |   IF v_job.category::text = 'declutter_help' AND NOT public.sell_for_me_listings_sent(v_job.id) THEN |   IF false THEN
// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql |      WHERE l.job_id = _job_id AND l.helpr_id = v_helper AND l.sent_at IS NOT NULL | WHERE l.job_id = _job_id
// @mutate supabase/migrations/20261101034159_declutter_list_for_seller.sql | REVOKE ALL ON TABLE public.declutter_listed_for_seller FROM PUBLIC, anon, authenticated; | GRANT SELECT ON TABLE public.declutter_listed_for_seller TO authenticated;
// @mutate supabase/functions/create-payment/index.ts |           if (sent !== true) throw new PublicError | if (false) throw new PublicError
// @mutate supabase/functions/create-payment/index.ts |           if (sentErr) { | if (false) {
//
// LEAD-LIST-FOR-SELLER (owner 10-31 ~10:30 PM, POST-H3; lead decision): a "Have a Helpr list it" job is done for the
// Helpr once they have SENT its listings to the seller for approval (never stranded waiting for the seller). Mark done
// has three doors and all three must ask the same rule: the jobs trigger (authoritative), rpc_helper_mark_done (the
// clean refusal), and create-payment's release path (a service-role write the trigger's caller check skips), which
// must fail CLOSED on an error. The link table that says who wrote a listing is private.
// Behaviour under real roles: src/test/pglite/declutterListForSeller.pglite.mjs (NEW_MIGRATION=skip red).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
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
});
