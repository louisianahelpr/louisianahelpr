/**
 * Handoff item 3 (migration 20261112024127): the departed-member scrub also removes the bare FIRST NAME that Declutter
 * manager-mode notices use ("Ann listed "Lamp" for you"), only at the start of the title or message, only in a
 * Declutter notice (no job, link '/declutter%') to a member with a declutter_manager_grants row with the departed member
 * on the other side.
 *
 * Reads the EFFECTIVE definition. Backend proof: src/test/pglite/departedScrubManagerFirstName.pglite.mjs
 * (3x; FAILs without the migration; 5 mutants each FAIL).
 */
// @mutate supabase/migrations/20261112024127_departed_member_scrub_manager_first_name.sql |     v_rx := '^' \|\| v_esc \|\| '(?!\w)(?! \w\.)'; |     v_rx := '\m' \|\| v_esc \|\| '(?!\w)';
// @mutate supabase/migrations/20261112024127_departed_member_scrub_manager_first_name.sql |             OR coalesce(n.message, '') ~ v_rx_share OR |             OR false OR
// @mutate supabase/migrations/20261112024127_departed_member_scrub_manager_first_name.sql |                     WHERE (g.seller_id = OLD.user_id AND g.manager_id = n.user_id) |                     WHERE (g.seller_id = OLD.user_id OR g.manager_id = n.user_id)
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const fn = blankSqlComments(defs.get("scrub_departed_member_name_from_notifications")?.stmt ?? "").replace(/\s+/g, " ");

describe("departed-member scrub: manager-mode first names", () => {
  it("reads the newest definition (floor)", () => {
    expect(fn.length).toBeGreaterThan(2000);
    expect(defs.get("scrub_departed_member_name_from_notifications")?.file).toMatch(/_departed_member_scrub_[a-z_]+\.sql$|_departed_member_[a-z_]+\.sql$/);
  });

  it("first word of member_display_name, anchored at the start only", () => {
    expect(fn).toContain("v_first := split_part(coalesce(public.member_display_name(OLD.full_name, NULL), ''), ' ', 1);");
    expect(fn).toContain("v_rx := '^' || v_esc || '(?!\\w)(?! \\w\\.)';");
    expect(fn).toContain("v_rx_share := '(You earned \\$[0-9.]+ from )' || v_esc || '(?=''s sale of )';");
    expect(fn).toContain("v_rx_split := '( · \\$[0-9.]+ to )' || v_esc || '(?=( \\([0-9]+%\\))? · \\$)';");
    expect(fn).toContain("SET title = regexp_replace(n.title, v_rx, 'A former member'), message = regexp_replace(regexp_replace(regexp_replace(n.message, v_rx, 'A former member'), v_rx_share, '\\1a former member'), v_rx_split, '\\1a former member', 'g')");
    expect(fn).toContain("OR coalesce(n.message, '') ~ v_rx_share OR coalesce(n.message, '') ~ v_rx_split)");
  });

  it("only Declutter notices to the other side of a manager grant", () => {
    expect(fn).toContain("AND n.job_id IS NULL AND coalesce(n.link, '') LIKE '/declutter%' AND EXISTS (SELECT 1 FROM public.declutter_manager_grants g WHERE (g.seller_id = OLD.user_id AND g.manager_id = n.user_id) OR (g.manager_id = OLD.user_id AND g.seller_id = n.user_id))");
  });
});
