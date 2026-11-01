/**
 * EVERY CONFIRMED CREW MEMBER WAS A NO-SHOW: THE POSTER CAN CANCEL FOR A FULL REFUND (JOBS-3 follow-up, lead verdict
 * 10-31 on wip/b54-1031).
 *
 * Before: after the poster reported the last confirmed member (rpc_poster_report_member_no_show deletes their roster
 * row), nobody was left and nobody had finished, so rpc_group_member_mark_done's roll-up (v_done >= 1) could never
 * complete the crew, and the in-progress card offered no Cancel (derivePosterStep draws none for in_progress). The
 * job sat under way with the poster's money held.
 *
 * The job page (posterPageActions) offers its Cancel job for the same crew (usePosterPageFlows.crewNobodyLeft, from
 * the loaded detail read). Now the poster's crew roster (GroupJobHelpers) offers "Cancel and get a refund" once the roster has loaded, the
 * job is in_progress and no roster row names a Helpr (crewNobodyLeft). It opens the card's own cancel
 * (tryCancelJob -> CancellationDialog -> poster_cancel_job). The cancel's pre-check reads only members still on the
 * roster, so a reported member's old "on my way" tracking row no longer blocks it.
 *
 * The server needs no change, and this file pins why: the newest poster_cancel_job accepts in_progress, prices a
 * crew only over roster rows that name a Helpr (an empty roster writes no share: fee 0), and its late flag (the
 * poster's strike) is is_late_cancellation(v_committed, ...), false when nobody is committed. Each no-show already
 * got their strike when reported (crewMemberNoShow.test.tsx / crewMemberNoShow.pglite.mjs).
 *
 * @mutate src/lib/crewLifecycle.ts |   return rosterKnown && jobStatus === "in_progress" && !roster.some((m) => m.helper_id != null); |   return jobStatus === "in_progress" && !roster.some((m) => m.helper_id != null);
 * @mutate src/lib/crewLifecycle.ts |   return rosterKnown && jobStatus === "in_progress" && !roster.some((m) => m.helper_id != null); |   return rosterKnown && jobStatus === "in_progress";
 * @mutate src/components/GroupJobHelpers.tsx |       {nobodyLeft && ( |       {false && (
 * @mutate src/components/GroupJobHelpers.tsx |           <Button variant="outline" size="lg" className="w-full rounded-full text-ds-15 text-destructive-ink" onClick={onCancelJob}> |           <Button variant="outline" size="lg" className="w-full rounded-full text-ds-15 text-destructive-ink">
 * @mutate src/pages/posts/PostedJobCard.tsx |  onCancelJob={() => onCancel(job)} /> |  />
 * @mutate src/pages/jobs/jobPage/usePosterPageFlows.tsx |     crewNobodyLeft: !!detail && job.is_group_job === true && crewNobodyLeft(job.status, detail.groupHelpersByJob?.[job.id] ?? [], true), |     crewNobodyLeft: false,
 * @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts |     if (crewOnRoster) trackingQuery = trackingQuery.in("helper_id", crewOnRoster); |     void crewOnRoster;
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => {
  // A per-card roster read that never answers: the roster is not known yet.
  const pending = { select: () => pending, eq: () => new Promise(() => {}) };
  return { supabase: { from: vi.fn(() => pending), rpc: vi.fn() } };
});
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticMedium: vi.fn() }));

const { GroupJobHelpers } = await import("@/components/GroupJobHelpers");
const { crewNobodyLeft } = await import("@/lib/crewLifecycle");

const ROOT = resolve(__dirname, "../..");
const defs = latestFunctionDefs(resolve(ROOT, "supabase/migrations"));
const cancelBody = (defs.get("poster_cancel_job")?.body ?? "").replace(/\s+/g, " ");

describe("crewNobodyLeft", () => {
  const gone = [{ helper_id: null }];
  it("an under-way crew whose roster names nobody", () => {
    expect(crewNobodyLeft("in_progress", [], true)).toBe(true);
    expect(crewNobodyLeft("in_progress", gone, true)).toBe(true);
  });
  it.each([
    ["while the roster is still loading", "in_progress", [], false],
    ["while a member is still on the crew", "in_progress", [{ helper_id: "m2" }], true],
    ["before the job is under way (Cancel is already on the card)", "accepted", [], true],
    ["on a finished job", "completed", [], true],
    ["on a cancelled job", "cancelled", [], true],
  ] as const)("never %s", (_w, status, roster, known) => {
    expect(crewNobodyLeft(status, roster, known)).toBe(false);
  });
});

describe("the poster's crew roster offers Cancel when nobody is left", () => {
  const view = (props: { initialHelpers?: Array<Record<string, unknown>>; jobStatus?: string; isOwner?: boolean; onCancelJob?: () => void }) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <GroupJobHelpers jobId="j" helpersNeeded={2} isOwner={props.isOwner ?? true} jobStatus={props.jobStatus ?? "in_progress"}
          initialHelpers={props.initialHelpers as never} dateNeeded="2032-10-30" startTime="09:00"
          onCancelJob={"onCancelJob" in props ? props.onCancelJob : vi.fn()} />
      </QueryClientProvider>,
    );
  const button = () => screen.queryByRole("button", { name: "Cancel and get a refund" });

  it("every member reported: the button opens the card's cancel, and says the money all comes back", () => {
    const onCancelJob = vi.fn();
    view({ initialHelpers: [], onCancelJob });
    expect(button()).toBeInTheDocument();
    expect(document.body.textContent).toContain("Nobody from your crew came. Cancel the job and you get all your money back.");
    // Not the partial-refund line beside it: with nobody left the whole budget comes back.
    expect(document.body.textContent).not.toContain("Most of that share comes back to you after the job.");
    fireEvent.click(button()!);
    expect(onCancelJob).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["while a member is still on the crew", { initialHelpers: [{ id: "s2", helper_id: "m2", status: "accepted", helperName: "Remy", helper_confirmed_at: "2032-10-29T12:00:00Z" }] }],
    ["while the roster is still loading", { initialHelpers: undefined }],
    ["to anyone but the poster", { initialHelpers: [], isOwner: false }],
    ["before the job is under way", { initialHelpers: [], jobStatus: "accepted" }],
    ["without the card's cancel to open", { initialHelpers: [], onCancelJob: undefined }],
  ])("not %s", (_w, props) => {
    view(props as never);
    expect(button()).not.toBeInTheDocument();
  });
});

describe("the server: the cancel refunds an empty crew in full, with no strike on the poster", () => {
  it("poster_cancel_job is defined", () => {
    expect(defs.size).toBeGreaterThan(500);
    expect(cancelBody.length).toBeGreaterThan(1000);
  });
  it.each([
    ["accepts a job under way", "IF v_job.status::text NOT IN ('open', 'accepted', 'in_progress', 'revision_requested') THEN"],
    ["refuses once anyone on the crew finished (the roll-up's case)", "WHERE g.job_id = v_job.id AND g.helper_completed_at IS NOT NULL ) THEN RAISE EXCEPTION 'not_cancellable'"],
    ["is committed only by a roster row that names a Helpr", "WHERE g.job_id = v_job.id AND g.helper_id IS NOT NULL AND (public.crew_fee_pays_unconfirmed() OR g.helper_confirmed_at IS NOT NULL)"],
    ["prices shares only over those rows", "FROM public.group_job_helpers g WHERE g.job_id = v_job.id AND g.helper_id IS NOT NULL ) m ON CONFLICT (job_id, helper_id) DO NOTHING;"],
    ["the fee is the sum of those shares (none: 0)", "SELECT COALESCE(sum(s.share_amount), 0) INTO v_fee FROM public.crew_cancellation_fee_shares s WHERE s.job_id = v_job.id;"],
    ["the poster's late flag needs someone committed", "v_late := public.is_late_cancellation(v_committed, v_hours);"],
  ])("%s", (_w, clause) => {
    expect(cancelBody).toContain(clause);
  });
});

describe("the wiring", () => {
  it("the Posted card hands its own cancel to the crew roster", () => {
    const card = blankComments(readFileSync(resolve(ROOT, "src/pages/posts/PostedJobCard.tsx"), "utf8"));
    expect(card).toContain("onCancelJob={() => onCancel(job)}");
  });
  it("the job page knows nobody is left once its detail read is in (posterPageActions then offers Cancel job: JobPage.test.tsx)", () => {
    const f = blankComments(readFileSync(resolve(ROOT, "src/pages/jobs/jobPage/usePosterPageFlows.tsx"), "utf8"));
    expect(f).toContain("crewNobodyLeft: !!detail && job.is_group_job === true && crewNobodyLeft(job.status, detail.groupHelpersByJob?.[job.id] ?? [], true),");
  });
  it("the cancel's pre-check reads only the members still on the roster for a crew", () => {
    const h = blankComments(readFileSync(resolve(ROOT, "src/components/job-card/activityActions/useLifecycleHandlers.ts"), "utf8"));
    expect(h).toContain('supabase.from("group_job_helpers").select("helper_id").eq("job_id", job.id)');
    expect(h).toContain('if (crewOnRoster) trackingQuery = trackingQuery.in("helper_id", crewOnRoster);');
  });
});
