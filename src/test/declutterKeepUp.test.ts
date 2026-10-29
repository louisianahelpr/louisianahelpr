/**
 * Owner 2026-10-29 (pop-up answer): "Keep it up until it sells", a seller switch, off by default. With it on, the
 * hourly listing-rounds sweep renews the listing every 30 days with no cap and sends no "ends soon" / "back up"
 * notices; off, the 30-days-a-round rule (Q2461) runs exactly as before. This binds the NEWEST definitions (comments
 * blanked) to that rule, the switch's gates and grants, and the words the seller reads.
 * Behaviour (renew with no cap, no notices, off mid-way never ends sooner than 3 days with the notice due, refusals)
 * is the PGlite proof src/test/pglite/declutterKeepUp.pglite.mjs (applied 3x, 7 mutants each red).
 *
 * @mutate supabase/migrations/20261029154323_declutter_keep_up_until_sold.sql |       IF public.declutter_keeps_up(r.id) THEN |       IF false THEN
 * @mutate supabase/migrations/20261029154323_declutter_keep_up_until_sold.sql |        AND NOT public.declutter_keeps_up(i.id) |        AND true
 * @mutate supabase/migrations/20261029154323_declutter_keep_up_until_sold.sql |   IF v_was AND NOT p_on AND v_item.status = 'live' THEN |   IF false THEN
 * @mutate supabase/migrations/20261029154323_declutter_keep_up_until_sold.sql | WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE; | WHERE id = p_item_id FOR UPDATE;
 * @mutate supabase/migrations/20261029154323_declutter_keep_up_until_sold.sql | REVOKE ALL ON FUNCTION public.declutter_set_keep_up(uuid, boolean) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_set_keep_up(uuid, boolean) FROM PUBLIC;
 * @mutate src/components/declutter/KeepUpRow.tsx | export const KEEP_UP_EXPLAINER = "It renews every 30 days until someone buys it. You can turn this off anytime."; | export const KEEP_UP_EXPLAINER = "It stays up.";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { KEEP_UP_EXPLAINER, KEEP_UP_TITLE } from "@/components/declutter/KeepUpRow";
import { LISTING_LIFETIME_KEEP_UP } from "@/components/declutter/DeclutterSellSteps";

const DIR = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const MIG = blankSqlComments(readFileSync(join(DIR, "20261029154323_declutter_keep_up_until_sold.sql"), "utf8")).replace(/\s+/g, " ");

describe("Declutter: keep it up until it sells", () => {
  it("reads a real inventory (floors)", () => {
    expect(body("declutter_listing_rounds_sweep").length).toBeGreaterThan(1500);
    expect(body("declutter_set_keep_up").length).toBeGreaterThan(400);
    expect(body("declutter_keep_up_state").length).toBeGreaterThan(150);
  });

  it("the sweep sends no 'ends soon' notice and renews every 30 days with no cap while the switch is on", () => {
    const b = body("declutter_listing_rounds_sweep");
    expect(b).toContain("AND NOT public.declutter_keeps_up(i.id)");
    expect(b).toContain("IF FOUND AND NOT public.declutter_keeps_up(it.id) THEN");
    // The keep-up branch comes before the capped relist, renews 30 days, and neither counts nor notifies.
    const branch = /IF public\.declutter_keeps_up\(r\.id\) THEN(.*?)ELSIF r\.relist_count < 3 THEN/.exec(b)?.[1] ?? "";
    expect(branch).toContain("SET listed_until = now() + interval '30 days', round_nudged = NULL");
    expect(branch).not.toContain("relist_count");
    expect(branch).not.toContain("declutter_notify");
    expect(body("declutter_keeps_up")).toContain("p.keep_up_until_sold");
  });

  it("the switch: seller's own listing, behind the Declutter switch, not for a banned caller; off never ends it sooner than 3 days", () => {
    const s = body("declutter_set_keep_up");
    expect(s).toContain("PERFORM public.require_feature('declutter');");
    expect(s).toContain("IF public.is_caller_banned() THEN");
    expect(s).toContain("WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;");
    expect(s).toContain("IF v_was AND NOT p_on AND v_item.status = 'live' THEN");
    expect(s).toContain("THEN now() + interval '3 days' ELSE listed_until END, round_nudged = NULL");
    const r = body("declutter_keep_up_state");
    expect(r).toContain("PERFORM public.require_feature('declutter');");
    expect(r).toContain("AND i.seller_id = v_uid");
  });

  it("grants by role name: the switch for signed-in members, the sweep's read and the sweep for no client", () => {
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.declutter_set_keep_up(uuid, boolean) FROM PUBLIC, anon;");
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.declutter_keep_up_state(uuid) FROM PUBLIC, anon;");
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.declutter_keeps_up(uuid) FROM PUBLIC, anon, authenticated;");
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.declutter_listing_rounds_sweep() FROM PUBLIC, anon, authenticated;");
    expect(MIG).toContain("ADD COLUMN IF NOT EXISTS keep_up_until_sold boolean NOT NULL DEFAULT false");
  });

  it("the seller reads what the server does", () => {
    expect(KEEP_UP_TITLE).toBe("Keep it up until it sells");
    expect(KEEP_UP_EXPLAINER).toBe("It renews every 30 days until someone buys it. You can turn this off anytime.");
    expect(LISTING_LIFETIME_KEEP_UP).toMatch(/^Until it sells\. It renews every 30 days by itself, with no reminders\.$/);
  });
});
