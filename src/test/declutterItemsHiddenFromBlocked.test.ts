/**
 * Q1888: a member in a block with a seller (either direction) no longer reads that seller's live Declutter listings.
 * Reads the NEWEST definition of the items member read policy (the last migration, by file name, that creates it;
 * SQL comments blanked) and the EFFECTIVE definition of declutter_my_block_partners.
 * Backend proof on a real database: src/test/pglite/declutterItemsHiddenFromBlocked.pglite.mjs (3x; 8 FAIL without
 * the migration; RED with the REVOKE dropped, the block clause dropped, or only one block direction).
 * @mutate supabase/migrations/20261102022901_declutter_items_hidden_from_blocked.sql |         AND NOT (seller_id = ANY (coalesce((SELECT public.declutter_my_block_partners()), '{}'::uuid[])))) |         )
 * @mutate supabase/migrations/20261102022901_declutter_items_hidden_from_blocked.sql |      AND (b.blocker_id = (SELECT auth.uid()) OR b.blocked_id = (SELECT auth.uid())); |      AND (b.blocker_id = (SELECT auth.uid()));
 * @mutate supabase/migrations/20261102022901_declutter_items_hidden_from_blocked.sql | REVOKE ALL ON FUNCTION public.declutter_my_block_partners() FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_my_block_partners() FROM PUBLIC;
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = resolve(__dirname, "../../supabase/migrations");
const POLICY = `CREATE POLICY "declutter items: seller or switched-on members read live" ON public.declutter_items`;
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const withPolicy = files.filter((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8")).includes(POLICY));
const newest = withPolicy[withPolicy.length - 1] ?? "";
const flat = (s: string) => s.replace(/\s+/g, " ");
const body = flat(blankSqlComments(readFileSync(join(MIG, newest), "utf8")));
const policy = body.slice(body.indexOf(POLICY), body.indexOf(";", body.indexOf(POLICY)));
const HELPER = flat(blankSqlComments(effectiveDefs(MIG).get("declutter_my_block_partners")?.stmt ?? ""));
const newestHelperFile = files.filter((f) => /FUNCTION public\.declutter_my_block_partners\(/.test(blankSqlComments(readFileSync(join(MIG, f), "utf8")))).pop() ?? "";
const helperFileBody = flat(blankSqlComments(readFileSync(join(MIG, newestHelperFile || files[0]), "utf8")));

describe("a blocked pair does not read each other's Declutter listings (Q1888)", () => {
  it("reads the newest policy and helper (floors)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(withPolicy.length).toBeGreaterThan(3);
    expect(policy.length).toBeGreaterThan(300);
    expect(HELPER.length).toBeGreaterThan(200);
  });

  it("the browse branch of the items read policy excludes the caller's block partners", () => {
    expect(policy).toContain("AND NOT (seller_id = ANY (coalesce((SELECT public.declutter_my_block_partners()), '{}'::uuid[])))");
  });

  it("the helper covers both directions, only for the caller, and anon cannot run it", () => {
    expect(HELPER).toContain("SECURITY DEFINER");
    expect(HELPER).toContain("(b.blocker_id = (SELECT auth.uid()) OR b.blocked_id = (SELECT auth.uid()))");
    expect(helperFileBody).toContain("REVOKE ALL ON FUNCTION public.declutter_my_block_partners() FROM PUBLIC, anon;");
  });
});
