/**
 * Owner, 2026-10-23: every apply asks "Does <day> at <time> work for you?"; a Helpr may suggest another
 * day/time; the poster sees it on the applicant card; hiring them agrees to it, behind a screen that says
 * so ("since you are hiring you are also agreeing to the helpr's suggested date time").
 *
 * Executable proof of the server side (store, refusals, hire moves the job, plain hire refused, 3x replay):
 * src/test/pglite/applicationSuggestsATime.pglite.mjs. This file pins each layer so none can drop out:
 * the migration's trigger and wrapper, the apply call, the hire call, the hire screen's agreement note,
 * the applicant card's chip and the apply sheet's question.
 *
 * @mutate supabase/migrations/20261023134752_application_suggests_a_time.sql |   BEFORE UPDATE OF status ON public.applications | --
 * @mutate src/components/job-card/activityActions/useOfferHandlers.ts |     const agreesToSuggestion = !isGroupJob && !!deadlineDialogApp.suggested_date; |     const agreesToSuggestion = false;
 * @mutate src/pages/home/useApplyFlow.ts |       const { data: rpcData, error: rpcError } = suggestion\n | const { data: rpcData, error: rpcError } = false\n
 * @mutate src/components/ResponseDeadlineDialog.tsx |           {suggestedTime && (when \|\| suggestedLabel) && ( |           {false && (
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx |                             <ApplicantSuggestedTime app={app} jobStartTime={selectedJob.start_time} /> |
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { ApplyTimeQuestion, canSuggestATime } from "@/components/dashboard/applyConfirmDialog/ApplyTimeQuestion";
import { ApplicantSuggestedTime } from "@/pages/posts/postedJobs/applicantsPanel/ApplicantSuggestedTime";
import type { EnrichedJob } from "@/components/dashboard/types";

const read = (p: string) => blankComments(readFileSync(p, "utf8"));
const MIG = blankSqlComments(readFileSync("supabase/migrations/20261023134752_application_suggests_a_time.sql", "utf8"));

const job = {
  id: "job-1", title: "Mow", description: "", category: "yard_work", budget: 50, date_needed: "2099-01-10",
  start_time: "12:00:00", location: "x", customer_id: "p", status: "open", created_at: "2026-10-23T00:00:00Z",
} as unknown as EnrichedJob;

describe("a Helpr can suggest another day/time; hiring them agrees to it (owner 2026-10-23)", () => {
  it("server: the wrapper runs the unchanged apply, then stores the suggestion; the plain hire of a suggester is refused", () => {
    expect(MIG).toMatch(/v_app_id := public\.apply_to_job\(p_job_id, p_message\);[\s\S]*SET suggested_date = p_suggested_date/);
    expect(MIG).toMatch(/CREATE TRIGGER trg_applications_hire_agrees_to_suggestion\s+BEFORE UPDATE OF status ON public\.applications/);
    expect(MIG).toMatch(/RAISE EXCEPTION 'suggested_time_not_agreed'/);
    // The hire moves the job FIRST (every date-edit rule runs), then hires through the unchanged accept.
    expect(MIG).toMatch(/UPDATE public\.jobs\s+SET date_needed = v_date[\s\S]*PERFORM public\.accept_application\(p_application_id, p_deadline, p_offer_message\);/);
  });

  it("client: a suggestion applies through apply_to_job_with_time; a suggester is hired through the agreeing RPC", () => {
    const flow = read("src/pages/home/useApplyFlow.ts");
    expect(flow).toMatch(/suggestion\s*\?\s*await supabase\.rpc\("apply_to_job_with_time"/);
    const hire = read("src/components/job-card/activityActions/useOfferHandlers.ts");
    expect(hire).toMatch(/const agreesToSuggestion = !isGroupJob && !!deadlineDialogApp\.suggested_date;/);
    expect(hire).toMatch(/agreesToSuggestion\s*\?\s*await supabase\.rpc\("accept_application_at_suggested_time"/);
  });

  it("the hire screen says the poster is agreeing to the suggested time, and the button says so", () => {
    const dlg = read("src/components/ResponseDeadlineDialog.tsx");
    // The note renders whenever the applicant suggested a time (not behind any other condition).
    expect(dlg).toMatch(/\{suggestedTime && \(when \|\| suggestedLabel\) && \(\s*<div[\s\S]{0,400}?data-hire-agrees-to-suggestion=""[\s\S]{0,200}?you&rsquo;re also agreeing to their suggested time/);
    expect(dlg).toMatch(/It keeps the new time even if they don&rsquo;t accept\./);
    expect(dlg).toMatch(/suggestedTime \? "Agree and send offer" : "Send offer"/);
    const mount = read("src/components/job-card/ActivityDialogs.tsx");
    expect(mount).toMatch(/suggestedTime=\{\s*props\.deadlineDialogApp\.suggested_date/);
  });

  it("the applicant card shows the suggestion; nothing when the job's time works", () => {
    const { container, rerender } = render(<ApplicantSuggestedTime app={{ suggested_date: "2099-01-11", suggested_start_time: "14:00:00" }} />);
    expect(container.textContent).toMatch(/^Suggests .*Jan 11.* at 2:00 PM$/);
    rerender(<ApplicantSuggestedTime app={{ suggested_date: null }} />);
    expect(container.textContent).toBe("");
    expect(read("src/pages/posts/postedJobs/ApplicantsPanel.tsx")).toMatch(/<ApplicantSuggestedTime app=\{app\}/);
    expect(read("src/pages/posts/postedJobs/applicantsPanel/ApplicantsDesktopTable.tsx")).toMatch(/<ApplicantSuggestedTime app=\{app\}/);
  });

  it("the apply sheet asks, defaults to yes, and a suggestion is tied to its job", () => {
    const onChange = vi.fn();
    render(<ApplyTimeQuestion job={job} value={null} onChange={onChange} />);
    expect(screen.getByText(/Does .* at 12:00 PM work for you\?/)).toBeTruthy();
    expect(screen.getByTestId("apply-time-yes").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("apply-time-suggest"));
    // Pre-filled with the job's own day and start time, so nothing empty looks like a choice.
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-1", date: "2099-01-10", time: "12:00" }));
    // Asked only where another time can be honoured.
    expect(canSuggestATime(job)).toBe(true);
    for (const over of [{ is_group_job: true }, { parent_job_id: "p" }, { is_recurring: true }, { pricing_mode: "quotes" }, { date_needed: null }]) {
      expect(canSuggestATime({ ...job, ...over } as EnrichedJob), JSON.stringify(over)).toBe(false);
    }
    expect(read("src/components/dashboard/applyConfirmDialog/ApplyBody.tsx")).toMatch(/canSuggestATime\(confirmApplyJob\) && \(\s*<ApplyTimeQuestion/);
  });
});
