/**
 * Q2418: a same-job haul-away re-link touches the link rows' updated_at, so declutter_haul_away_sweep Part C (which
 * undoes only a link untouched for 7 days) never puts the items back on sale under a retry that is about to pay.
 * Backend proof: src/test/pglite/declutterHaulAwayRelinkTouches.pglite.mjs (3x; red on the 20261028223036 version and
 * on its planted defects).
 *
 * @mutate supabase/migrations/20261102050858_declutter_haul_away_relink_touches_the_link.sql |     UPDATE public.declutter_haul_aways SET updated_at = now() WHERE item_id = ANY (v_ids) AND job_id = p_job_id;\n | \n
 * @mutate supabase/migrations/20261102050858_declutter_haul_away_relink_touches_the_link.sql |         UPDATE public.declutter_haul_aways SET updated_at = now() WHERE item_id = v_item.id;\n        CONTINUE; |         CONTINUE;
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => s.replace(/\s+/g, " ");
const body = (name: string) => flat(blankSqlComments(defs.get(name)?.stmt ?? ""));

describe("a haul-away retry's re-link keeps its link fresh for the daily sweep", () => {
  it("both same-job re-link paths touch the link, and the sweep still skips a fresh link", () => {
    expect(defs.size).toBeGreaterThan(500);
    const link = body("declutter_link_haul_away");
    expect(link.length).toBeGreaterThan(3000);
    expect(link).toContain("UPDATE public.declutter_haul_aways SET updated_at = now() WHERE item_id = ANY (v_ids) AND job_id = p_job_id; RETURN cardinality(v_ids);");
    expect(link).toContain("IF v_link.job_id = p_job_id THEN UPDATE public.declutter_haul_aways SET updated_at = now() WHERE item_id = v_item.id; CONTINUE;");
    // The sweep reads the link under the item lock and skips one touched in the last 7 days.
    expect(body("declutter_haul_away_sweep")).toContain("IF NOT FOUND OR v_link.updated_at > now() - interval '7 days' THEN CONTINUE;");
  });
});
