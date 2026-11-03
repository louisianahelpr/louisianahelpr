/**
 * A3-75 (audit 11-01): a Declutter review can be reported, never by the person who wrote it, and an admin takes it
 * down; a removed review leaves every member-facing read and the public star rating. Reads the EFFECTIVE (newest)
 * definitions; behaviour on a real database is src/test/pglite/declutterReviewReport.pglite.mjs (3x, Supabase's default
 * anon execute grant emulated; NEW_MIGRATION=skip 22 RED; 15 planted defects each RED).
 *
 * @mutate supabase/migrations/20261102040000_declutter_review_report.sql | 'declutter_answer'::text, 'declutter_review'::text])); | 'declutter_answer'::text]));
 * @mutate supabase/migrations/20261102040000_declutter_review_report.sql |     IF NOT public.is_server_context() AND NEW.reporter_id IS NOT DISTINCT FROM dr.reviewer_id THEN |     IF false THEN
 * @mutate supabase/migrations/20261102040000_declutter_review_report.sql |                         OR dro.handed_over_at <= now() - interval '14 days' |                         OR true
 * @mutate supabase/migrations/20261102040000_declutter_review_report.sql |      AND r.removed_at IS NULL  -- A3-75: an admin removed it after a report |      AND true
 * @mutate supabase/migrations/20261102040000_declutter_review_report.sql | after a report never counts.\n      AND dr.removed_at IS NULL | after a report never counts.\n      AND true
 * @mutate supabase/migrations/20261103052255_declutter_wanted_homes_admin_not_found_is_404.sql |   IF r.reviewer_id = v_uid OR r.reviewee_id = v_uid THEN |   IF false THEN
 * @mutate supabase/migrations/20261102040000_declutter_review_report.sql | REVOKE ALL ON FUNCTION public.declutter_admin_remove_review(uuid, text, uuid) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_admin_remove_review(uuid, text, uuid) FROM PUBLIC;
 * @mutate supabase/migrations/20261102040000_declutter_review_report.sql | REVOKE ALL ON FUNCTION public.declutter_admin_reported_reviews(uuid[]) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.declutter_admin_reported_reviews(uuid[]) FROM PUBLIC;
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = resolve(__dirname, "../../supabase/migrations");
const DEFS = effectiveDefs(MIG);
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = (f: string) => blankSqlComments(readFileSync(join(MIG, f), "utf8")).replace(/\s+/g, " ");
// The newest migration that sets the report types decides them.
const typeFile = [...files].reverse().find((f) => sqlOf(f).includes("ADD CONSTRAINT reports_reported_type_check")) ?? "";
const types = sqlOf(typeFile);
const NEW = "20261102040000_declutter_review_report.sql";

describe("Declutter reviews can be reported and taken down (A3-75)", () => {
  it("reads the newest definitions (floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(typeFile).not.toBe("");
    for (const fn of ["report_message_party_and_copy", "declutter_visible_reviews", "get_public_profile_stats", "notify_reporter_report_outcome"]) {
      expect(DEFS.get(fn)?.file ?? "", fn).not.toBe("");
      expect(flat(fn).length, fn).toBeGreaterThan(300);
    }
  });

  it("the report type is allowed, and the column exists", () => {
    expect(types).toMatch(/'declutter_review'::text\]\)\)/);
    expect(types).toMatch(/'declutter_question'::text, 'declutter_answer'::text/);
    expect(files.some((f) => sqlOf(f).includes("ALTER TABLE public.declutter_reviews ADD COLUMN IF NOT EXISTS removed_at timestamptz"))).toBe(true);
  });

  it("the copy trigger: only a review the reporter could be shown, never their own, and the older branches kept", () => {
    const f = flat("report_message_party_and_copy");
    expect(f).toContain("IF NEW.reported_type = 'declutter_review' THEN");
    expect(f).toContain("dr.removed_at IS NOT NULL");
    expect(f).toContain("OR dro.handed_over_at <= now() - interval '14 days' OR (SELECT count(*) FROM public.declutter_reviews r2 WHERE r2.order_id = dr.order_id) = 2)");
    expect(f).toContain("OR dr.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller())");
    expect(f).toContain("IF NOT public.is_server_context() AND NEW.reporter_id IS NOT DISTINCT FROM dr.reviewer_id THEN RAISE EXCEPTION 'report_own_content'");
    expect(f).toContain("IF NEW.reported_type IN ('declutter_question', 'declutter_answer') THEN");
    expect(f).toContain("IF NEW.reported_type = 'declutter_wanted' THEN");
    expect(f).toContain("NEW.reporter_id IS DISTINCT FROM m.receiver_id");
  });

  it("a removed review leaves the member read and the star rating", () => {
    expect(flat("declutter_visible_reviews")).toMatch(/WHERE r\.reviewee_id = p_user_id AND r\.removed_at IS NULL/);
    expect(flat("get_public_profile_stats")).toMatch(/AND dr\.removed_at IS NULL AND dr\.is_seed IS NOT TRUE/);
    expect(flat("notify_reporter_report_outcome")).toContain("WHEN 'declutter_review' THEN 'a review'");
  });

  it("the take-down and the queue's read are admin-only, never PUBLIC or anon; the take-down refuses your own review", () => {
    for (const fn of ["declutter_admin_remove_review", "declutter_admin_reported_reviews"]) {
      expect(flat(fn), fn).toMatch(/has_role\(.*'admin'::public\.app_role\) THEN RAISE EXCEPTION 'not_admin'/);
    }
    expect(flat("declutter_admin_remove_review")).toContain("IF r.reviewer_id = v_uid OR r.reviewee_id = v_uid THEN RAISE EXCEPTION 'own_review'");
    expect(flat("declutter_admin_remove_review")).toContain("rp.reported_type = 'declutter_review' AND rp.reported_id = p_review_id");
    expect(flat("declutter_admin_reported_reviews")).toContain("p.is_seed IS TRUE");
    const mig = sqlOf(NEW);
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.declutter_admin_remove_review(uuid, text, uuid) FROM PUBLIC, anon;");
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.declutter_admin_reported_reviews(uuid[]) FROM PUBLIC, anon;");
  });
});
