/**
 * Posting audit 10-30 #8. The class: a Wanted post has no Report or Block, a block from it cancels a shared job with a
 * late fee, a Wanted report reads as a deleted person in admin, or a member sees a Wanted photo no check passed. Read
 * from the NEWEST definitions and the screens, so a later restatement that loses any of it fails here.
 *
 * Behaviour (red/green, 3x replay, against block_user_and_settle's real text):
 * src/test/pglite/declutterWantedReportBlock.pglite.mjs
 *
 * @mutate supabase/migrations/20261030225143_declutter_wanted_report_block_photo_check.sql |   IF jsonb_array_length(COALESCE(v_result -> 'settled', '[]'::jsonb)) > 0 THEN | IF false THEN
 * @mutate supabase/migrations/20261030225143_declutter_wanted_report_block_photo_check.sql |            cleared.paths[1], |            w.photo_paths[1],
 * @mutate supabase/migrations/20261030225143_declutter_wanted_report_block_photo_check.sql |   IF w.is_seed IS NOT TRUE AND NOT EXISTS ( |   IF NOT EXISTS (
 * @mutate supabase/migrations/20261030225143_declutter_wanted_report_block_photo_check.sql |       PERFORM public.declutter_wanted_hold_photos(h.id, NULL, 'The automatic photo check did not finish.'); |       NULL;
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |       if (files.length > failed) checkPhotosInBackground(id); |       void id;
 * @mutate src/components/admin/AdminReports.tsx |         \|\| (r.reported_type === WANTED_REPORT && wantedPosts.get(r.reported_id)?.is_seed === true)\n |
 * @mutate src/components/admin/AdminReports.tsx |  && r.reported_type !== WANTED_REPORT && !isQuestionReport(r.reported_type); |  && !isQuestionReport(r.reported_type);
 * @mutate supabase/functions/declutter-ai-draft/index.ts |     if (!shopItem && body?.mode === "wanted_check") return await wantedCheck(req, admin, authData.user, body);\n |
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";
import { REASONS } from "@/components/reportDialog/reportReasons";

const sql = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const code = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("Report and Block on a Wanted post", () => {
  it("a block from a post rolls back whenever block_user_and_settle settled anything", () => {
    const b = sql("declutter_block_wanted_poster");
    expect(b).toContain("v_result := public.block_user_and_settle(w.user_id, 'Blocked from a Wanted post');");
    expect(b).toContain("IF jsonb_array_length(COALESCE(v_result -> 'settled', '[]'::jsonb)) > 0 THEN RAISE EXCEPTION 'wanted_block_shared_job'");
  });

  it("the block's refusal has words, and the card and the sheet both offer Report and Block", () => {
    expect(code("src/lib/lifecycleErrors.ts")).toContain("wanted_block_shared_job: DC.wanted_block_shared_job");
    const replies = code("src/components/declutter/DeclutterWantedReplies.tsx");
    expect(replies.match(/<WantedPostSafety post=/g)?.length).toBe(2);
    expect(replies).toContain('reportedType="declutter_wanted"');
    expect(REASONS.declutter_wanted.length).toBeGreaterThan(2);
  });

  it("a member's report is limited to a post they could be shown", () => {
    const t = sql("report_message_party_and_copy");
    expect(t).toContain("NOT w.public OR w.removed_at IS NOT NULL OR w.user_id = NEW.reporter_id");
    expect(t).toContain("seed_hidden_from_caller");
  });
});

describe("the admin half of a Wanted report", () => {
  const queue = code("src/components/admin/AdminReports.tsx");

  it("reads the post, never its id as a person", () => {
    expect(queue).toContain("r.reported_type !== LISTING_REPORT && r.reported_type !== WANTED_REPORT && !isQuestionReport(r.reported_type);");
    expect(queue).toContain("wantedSubject(wantedPosts.get(r.reported_id), wantedFailed)");
    expect(queue).toContain("<WantedReportPanel ");
    const panel = code("src/components/admin/adminReports/WantedReportPanel.tsx");
    expect(panel).toContain("takeDownWanted(post.wanted_id");
    expect(panel).toContain("releaseWantedPhotos(post.wanted_id");
  });

  it("test posts never reach admin: the queue drops them and the check files no report", () => {
    expect(queue).toContain("(r.reported_type === WANTED_REPORT && wantedPosts.get(r.reported_id)?.is_seed === true)");
    expect(sql("declutter_wanted_hold_photos")).toContain("IF w.is_seed IS NOT TRUE AND NOT EXISTS (");
  });

  it("only an admin acts, and each action is logged with its report", () => {
    for (const fn of ["declutter_admin_take_down_wanted", "declutter_admin_release_wanted_photos"]) {
      const b = sql(fn);
      expect(b).toContain("IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN");
      expect(b).toContain("INSERT INTO public.admin_audit_log");
      expect(b).toContain("'report_not_for_post'");
    }
    expect(sql("declutter_admin_reported_wanted")).toContain("has_role((SELECT auth.uid()), 'admin'::public.app_role)");
  });
});

describe("the automatic check on Wanted photos", () => {
  it("members see only cleared photos: browse is the one reader that shows them to anyone else", () => {
    const b = sql("declutter_wanted_browse");
    expect(b).toContain("WHERE p.path = ANY (w.photos_cleared)");
    expect(b).toContain("cleared.paths[1], cleared.paths");
    expect(b).not.toContain("w.photo_paths[1]");
  });

  it("the app asks for the check, the function records it, and a check that never returns reaches an admin", () => {
    expect(code("src/components/declutter/DeclutterWantedViews.tsx").match(/checkPhotosInBackground\(/g)?.length).toBe(3);
    const fn = code("supabase/functions/declutter-ai-draft/index.ts");
    expect(fn).toContain('body?.mode === "wanted_check"');
    expect(fn).toContain('admin.rpc("declutter_record_wanted_ai_check"');
    expect(sql("declutter_wanted_sweep")).toContain("PERFORM public.declutter_wanted_hold_photos(h.id, NULL,");
  });

  it("a flag can't be washed off by asking again", () => {
    expect(sql("declutter_record_wanted_ai_check")).toContain("AND NOT p.path = ANY (d.photos_held)");
  });
});
