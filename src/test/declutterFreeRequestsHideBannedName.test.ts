/**
 * b1e review should-fix (migration 20261112023218): the seller's free-item request list
 * (declutter_free_requests_for_item) shows no name across a block or a ban (declutter_names_hidden): the row reads
 * "A neighbor". It still drops a blocked requester's row (are_users_blocked).
 *
 * Reads the EFFECTIVE definition. Backend proof: src/test/pglite/declutterFreeRequestsHideBannedName.pglite.mjs
 * (3x; 4 FAIL without the migration; 2 mutants each FAIL).
 */
// @mutate supabase/migrations/20261112023218_declutter_free_requests_hide_banned_requester_name.sql |            CASE WHEN public.declutter_names_hidden(v_uid, r.requester_id) THEN 'A neighbor'\n |            CASE WHEN false THEN 'A neighbor'\n
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const fn = blankSqlComments(defs.get("declutter_free_requests_for_item")?.stmt ?? "").replace(/\s+/g, " ");

describe("free-item requests: no name across a block or a ban", () => {
  it("reads the newest definition (floor)", () => {
    expect(fn.length).toBeGreaterThan(600);
    expect(defs.get("declutter_free_requests_for_item")?.file).toMatch(/20261112023218_declutter_free_requests_hide_banned_requester_name\.sql$/);
  });

  it("the name is read only behind declutter_names_hidden", () => {
    expect(fn).toContain("CASE WHEN public.declutter_names_hidden(v_uid, r.requester_id) THEN 'A neighbor' ELSE public.member_display_name(p.full_name, 'A neighbor') END");
    expect(fn.match(/member_display_name\(/g)?.length).toBe(1);
    expect(fn).toContain("AND NOT public.are_users_blocked(v_uid, r.requester_id)");
  });
});
