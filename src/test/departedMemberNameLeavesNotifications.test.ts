/**
 * Q2330: a deleted member's "First L." left other members' stored notifications ("Bea T. applied to ..."),
 * though every other surface shows "Former member". purge_user_data deletes only the member's OWN rows.
 *
 * CLASS: the purge's profile redaction (step 4e: full_name = NULL with anonymized_at = now(), guarded on
 * anonymized_at IS NULL, in ONE UPDATE) fires an AFTER UPDATE OF anonymized_at trigger that rewrites the
 * member's full name and display name to "a former member" in other members' notifications whose job names
 * them BY ID (poster, hired Helpr, applicant, crew), never by text alone, and never staff rows. Checks, in the
 * NEWEST definitions: (1) the trigger exists on public.profiles, fires on anonymized_at going NULL -> set,
 * and calls the scrub function; (2) the scrub function matches whole words, scopes by job party id and
 * skips staff rows, and is SECURITY DEFINER with EXECUTE revoked from PUBLIC, anon, authenticated;
 * (3) purge_user_data still nulls full_name and stamps anonymized_at in the same guarded UPDATE, the one
 * statement the trigger keys on (if the purge stopped stamping anonymized_at, nothing would be scrubbed).
 * Backend proof: src/test/pglite/departedMemberNameLeavesNotifications.pglite.mjs (3x; NEW_MIGRATION=skip RED).
 *
 * @mutate supabase/migrations/20261103022806_departed_member_name_leaves_notifications.sql |   AFTER UPDATE OF anonymized_at ON public.profiles |   AFTER UPDATE OF phone ON public.profiles
 * @mutate supabase/migrations/20261112005443_declutter_departed_member_name_leaves_notices.sql |        AND ((n.job_id IS NOT NULL\n |        AND ((true\n
 * @mutate supabase/migrations/20261112005443_declutter_departed_member_name_leaves_notices.sql |              AND coalesce(n.link, '') LIKE '/declutter%'\n |
 * @mutate supabase/migrations/20261103022806_departed_member_name_leaves_notifications.sql | REVOKE ALL ON FUNCTION public.scrub_departed_member_name_from_notifications() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.scrub_departed_member_name_from_notifications() FROM PUBLIC;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "");
const FN = "scrub_departed_member_name_from_notifications";

function newestStatement(re: RegExp): string {
  for (let i = FILES.length - 1; i >= 0; i--) {
    const sql = blankSqlComments(readFileSync(join(MIG, FILES[i]), "utf8"));
    const all = [...sql.matchAll(re)];
    if (all.length) return all[all.length - 1][0];
  }
  return "";
}

describe("a deleted member's name leaves other members' notifications (Q2330)", () => {
  it("reads a real inventory", () => {
    expect(DEFS.size).toBeGreaterThan(500);
    expect(FILES.length).toBeGreaterThan(500);
  });

  it("the purge's anonymized_at stamp fires the scrub trigger on profiles", () => {
    const trig = newestStatement(/CREATE TRIGGER\s+trg_scrub_departed_member_name[\s\S]*?;/gi);
    expect(trig).toMatch(/AFTER\s+UPDATE\s+OF\s+anonymized_at\s+ON\s+public\.profiles/i);
    expect(trig).toMatch(/OLD\.anonymized_at IS NULL AND NEW\.anonymized_at IS NOT NULL/i);
    expect(trig).toMatch(new RegExp(`EXECUTE FUNCTION public\\.${FN}\\(\\)`, "i"));
  });

  it("the scrub matches whole names, scopes by job party id, skips staff, and is a locked definer", () => {
    const b = body(FN);
    expect(b).toMatch(/SECURITY DEFINER/i);
    expect(b).toMatch(/public\.member_display_name\(OLD\.full_name, NULL\)/);
    expect(b).toContain("'\\m' ||");
    expect(b).toContain("'(?!\\w)'");
    expect(b).toMatch(/n\.user_id IS DISTINCT FROM OLD\.user_id/);
    // 20261112005443: the job branch is now one of two (job notices as before, OR Declutter notices).
    expect(b).toMatch(/AND \(\(n\.job_id IS NOT NULL/);
    // F356 follow-up privacy fix: a Declutter notice (no job, a /declutter link) to someone who traded with the departed
    // member, through each Declutter table, either way round.
    expect(b).toMatch(/OR \(n\.job_id IS NULL\s+AND coalesce\(n\.link, ''\) LIKE '\/declutter%'/);
    for (const t of ["declutter_offers", "declutter_swap_offers", "declutter_cart_items", "declutter_orders", "declutter_bundle_requests", "declutter_free_requests"]) {
      expect(b).toContain(`FROM public.${t} `);
    }
    for (const party of [/OLD\.user_id IN \(j\.customer_id, j\.helper_id\)/, /a\.helper_id = OLD\.user_id/, /g\.helper_id = OLD\.user_id/]) {
      expect(b).toMatch(party);
    }
    expect(b).toMatch(/LIKE '\/admin%'/);
    const revoke = newestStatement(new RegExp(`REVOKE ALL ON FUNCTION public\\.${FN}\\(\\) FROM[^;]*;`, "gi"));
    expect(revoke).toMatch(/PUBLIC/);
    expect(revoke).toMatch(/\banon\b/);
    expect(revoke).toMatch(/\bauthenticated\b/);
  });

  it("purge_user_data still redacts the name and stamps anonymized_at in one guarded UPDATE", () => {
    const b = body("purge_user_data");
    const upd = b.match(/UPDATE public\.profiles\s+SET full_name\s*=\s*NULL,[\s\S]*?WHERE user_id = p_user_id\s+AND anonymized_at IS NULL/i)?.[0] ?? "";
    expect(upd).toMatch(/anonymized_at\s*=\s*now\(\)/i);
  });
});
