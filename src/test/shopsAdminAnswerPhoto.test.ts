/**
 * Shops Helpr delivery (Builder 5, 11-06): the Helpr's answer photo to a shop's "the Helpr didn't come" reaches the
 * admin who decides the held order. Reads the EFFECTIVE (newest) definitions; behaviour on a real database is
 * src/test/pglite/shopsAdminAnswerPhoto.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).
 *   - shop_helpr_answer_no_show writes the photo on the problem row only when its answer opens the problem;
 *   - shops_admin_queue returns it in 'problems';
 *   - the column is NOT in shop_handovers' column grant to authenticated (only an admin reads it, through the queue);
 *   - Admin -> Shops shows it (AdminShopsOrders.test.tsx case 8).
 *
 * @mutate supabase/migrations/20261107035259_shops_admin_answer_photo.sql |              h.ready_photo_path, h.ready_at, h.problem_photo_path, o.is_seed |              h.ready_photo_path, h.ready_at, o.is_seed
 * @mutate supabase/migrations/20261107035259_shops_admin_answer_photo.sql |                                                                  THEN EXCLUDED.problem_photo_path |                                                                  THEN NULL
 * @mutate supabase/migrations/20261107035259_shops_admin_answer_photo.sql |                                                                  ELSE public.shop_handovers.problem_photo_path END; |                                                                  ELSE EXCLUDED.problem_photo_path END;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIG);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string) => blankSqlComments(readFileSync(join(MIG, f), "utf8")).replace(/\s+/g, " ");

describe("the Helpr's answer photo reaches the Shops admin queue", () => {
  it("reads the newest definitions (floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
    for (const fn of ["shop_helpr_answer_no_show", "shops_admin_queue"]) {
      expect(DEFS.get(fn)?.file ?? "", fn).not.toBe("");
      expect(flat(fn).length, fn).toBeGreaterThan(1000);
    }
  });

  it("the answer puts its photo on the problem only when it opens the problem", () => {
    const f = flat("shop_helpr_answer_no_show");
    expect(f).toContain("INSERT INTO public.shop_handovers (order_id, problem_at, problem_note, problem_photo_path, is_seed)");
    expect(f).toContain("problem_photo_path = CASE WHEN public.shop_handovers.problem_at IS NULL THEN EXCLUDED.problem_photo_path ELSE public.shop_handovers.problem_photo_path END");
    // The photo check stays: only the Helpr's own task folder, uploaded.
    expect(f).toContain("split_part(p_photo_path, '/', 1) = v_uid::text");
    expect(f).toContain("RAISE EXCEPTION 'photo_not_uploaded'");
  });

  it("the admin queue returns it beside the note, and stays admin only", () => {
    const f = flat("shops_admin_queue");
    expect(f).toContain("h.problem_note, h.ready_photo_path, h.ready_at, h.problem_photo_path, o.is_seed");
    expect(f).toContain("IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN RAISE EXCEPTION 'admin_only'");
  });

  it("the buyer and the shop never get the column: the newest column grant to authenticated leaves it out", () => {
    const grants = files.flatMap((f) => sqlOf(f).match(/GRANT SELECT \([^)]*\) ON TABLE public\.shop_handovers TO authenticated/g) ?? []);
    expect(grants.length).toBeGreaterThan(0);
    expect(grants[grants.length - 1]).not.toContain("problem_photo_path");
  });
});
