/**
 * POST-H3 (owner pop-up 10-31 ~9:35 PM: "the job can't be marked done until the listings are live (the listings are
 * the proof)"): a "Have a Helpr list it for me" job (declutter_help) can be marked done only once a Declutter listing
 * of the seller's, created since the job was posted, has gone live. Behaviour proof (applied 3x, red on the newest
 * bodies before it): src/test/pglite/sellForMeDoneWaitsForListings.pglite.mjs.
 *
 * Holds, on the definitions the migrations leave (effectiveDefs reads the NEWEST, any dollar tag):
 *  - BOTH completion doors ask sell_for_me_listings_live for a declutter_help job before the stamp: the
 *    authoritative jobs trigger and the RPC's clean refusal;
 *  - neither lost the photo rule (the listings are added, nothing is loosened);
 *  - the helper reads only live / reserved / sold / completed listings since the job, and only for the job's own two people;
 *  - the Helpr's refusal has words (rpc_helper_mark_done's error table), and the Helpr reads the rule before the
 *    tap: SellForMeDoneNote on the on-site and working steps of a declutter_help job only.
 *
 * @mutate supabase/migrations/20261101024656_sell_for_me_done_waits_for_listings.sql |     IF OLD.category::text = 'declutter_help' AND NOT public.sell_for_me_listings_live(OLD.id) THEN | IF false THEN
 * @mutate supabase/migrations/20261101024656_sell_for_me_done_waits_for_listings.sql |   IF v_job.category::text = 'declutter_help' AND NOT public.sell_for_me_listings_live(v_job.id) THEN |   IF false THEN
 * @mutate supabase/migrations/20261101024656_sell_for_me_done_waits_for_listings.sql |        AND i.status IN ('live', 'reserved', 'sold', 'completed') |        AND i.status <> 'withdrawn'
 * @mutate supabase/migrations/20261101024656_sell_for_me_done_waits_for_listings.sql |        AND i.created_at >= COALESCE(v_since, '-infinity'::timestamptz) |        AND true
 * @mutate supabase/migrations/20261101024656_sell_for_me_done_waits_for_listings.sql |   IF v_seller IS NULL OR (auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM v_helper AND auth.uid() IS DISTINCT FROM v_seller) THEN |   IF v_seller IS NULL THEN
 * @mutate src/pages/jobs/appliedJobCard/steps/PayoutPrimary.tsx |   if (!job \|\| !isSellForMeJob(job.category) \|\| job.helper_completed_at) return null; |   if (!job \|\| job.helper_completed_at) return null;
 * @mutate src/pages/jobs/appliedJobCard/steps/WorkingStep.tsx |           <SellForMeDoneNote job={job} />\n | \n
 * @mutate src/lib/lifecycleErrors.ts |     completion_requires_live_listings: "The listings are the proof | completion_requires_live_listing: "The listings are the proof
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { lifecycleErrorMessage, rpcErrorMessage } from "@/lib/lifecycleErrors";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { SellForMeDoneNote } from "@/pages/jobs/appliedJobCard/steps/PayoutPrimary";
import { blankComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(join(process.cwd(), "supabase/migrations"));
const body = (name: string) => {
  const d = DEFS.get(name);
  expect(d, name).toBeTruthy();
  return blankSqlComments(d!.stmt).replace(/\s+/g, " ");
};

describe("POST-H3: a Have-a-Helpr-list-it job is done only once its listings are live", () => {
  it("both completion doors ask for live listings on a declutter_help job, before the stamp", () => {
    const trigger = body("enforce_helper_completion_gates");
    const rpc = body("rpc_helper_mark_done");
    expect(trigger).toContain("IF OLD.category::text = 'declutter_help' AND NOT public.sell_for_me_listings_live(OLD.id) THEN");
    expect(trigger).toContain("RAISE EXCEPTION 'completion_requires_live_listings'");
    expect(rpc).toContain("IF v_job.category::text = 'declutter_help' AND NOT public.sell_for_me_listings_live(v_job.id) THEN");
    expect(rpc.indexOf("completion_requires_live_listings")).toBeGreaterThan(0);
    expect(rpc.indexOf("completion_requires_live_listings")).toBeLessThan(rpc.indexOf("SET helper_completed_at = v_now"));
  });

  it("nothing is loosened: both doors keep the photo rule and the arrival rule", () => {
    for (const name of ["enforce_helper_completion_gates", "rpc_helper_mark_done"]) {
      const b = body(name);
      expect(b, name).toContain("'completion_requires_proof_photos'");
      expect(b, name).toContain("'completion_requires_confirmed_arrival'");
      expect(b, name).toContain("'completion_min_work_time'");
    }
  });

  it("the helper counts only listings that went live since the job, for the job's own two people", () => {
    const h = body("sell_for_me_listings_live");
    expect(h).toContain("AND i.status IN ('live', 'reserved', 'sold', 'completed')");
    expect(h).toContain("AND i.created_at >= COALESCE(v_since, '-infinity'::timestamptz)");
    expect(h).toContain("i.seller_id = v_seller");
    expect(h).toContain("IF v_seller IS NULL OR (auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM v_helper AND auth.uid() IS DISTINCT FROM v_seller) THEN");
  });

  it("the Helpr's refusal has words", () => {
    const err = { message: "completion_requires_live_listings" };
    // JobTracking's order: the shared reasons first, then this RPC's own table.
    const msg = lifecycleErrorMessage(err) ?? rpcErrorMessage("rpc_helper_mark_done", err);
    expect(msg).toMatch(/listings are live/);
  });

  it("the Helpr reads the rule before the tap, on a declutter_help job only, until it is done", () => {
    const note = (job: { category: string; helper_completed_at?: string | null }) => {
      const { container, unmount } = render(createElement(SellForMeDoneNote, { job }));
      const text = container.textContent ?? "";
      unmount();
      return text;
    };
    expect(note({ category: "declutter_help" })).toBe("Mark it done once the seller's listings are live on Declutter.");
    expect(note({ category: "moving" })).toBe("");
    expect(note({ category: "declutter_help", helper_completed_at: "2026-10-31T00:00:00Z" })).toBe("");
    for (const step of ["WorkingStep", "OnSiteStep"]) {
      const src = blankComments(readFileSync(join(process.cwd(), `src/pages/jobs/appliedJobCard/steps/${step}.tsx`), "utf8"));
      expect(src, step).toContain("<SellForMeDoneNote job={job} />");
    }
  });
});
