/**
 * Owner bug 2026-10-21: a member who had already applied still saw "Apply" on the job page. Every viewer
 * state, pinned: not applied, applied, offered, hired, declined, cancelled, filled/closed, own job.
 * @mutate src/pages/jobs/jobPage/viewerState.ts |     if (app.status === "pending" && o.job.status === "open") return |     if (false) return
 * @mutate src/pages/jobs/jobPage/viewerState.ts |   if (mineAssigned && !o.job.helper_confirmed_at && o.job.status === "accepted") { |   if (false) {
 * @mutate src/pages/jobs/jobPage/viewerState.ts |   if (o.offeredToMe && o.job.status === "open") { |   if (false) {
 * @mutate src/pages/jobs/jobPage/viewerState.ts |   if (o.onCrew) return { action: { kind: "open_working" }, status: null }; |
 * @mutate src/pages/jobs/jobPage/useJobPage.ts |   return { job, applicants, isPoster, myApplication, tracking, onCrew: onCrew.data === true }; |   return { job, applicants, isPoster, myApplication, tracking, onCrew: false };
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | .from("group_job_helpers").select("id").eq("job_id", jobId).eq("helper_id", userId) | .from("group_job_helpers").select("id").eq("job_id", jobId)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { jobPageViewerState } from "./viewerState";

const ME = "me";
const open = { status: "open", helper_id: null };
const run = (job: { status: string; helper_id: string | null; helper_confirmed_at?: string | null }, app: { status: string; closed_reason: string | null } | null, isPoster = false) =>
  jobPageViewerState({ isPoster, userId: ME, job, myApplication: app, posterFirst: "Lexi" });

describe("job page: what each viewer is offered", () => {
  const table: Array<[string, ReturnType<typeof run>, string, string | null]> = [
    ["not applied, open", run(open, null), "apply", null],
    ["direct offer to me, never applied", jobPageViewerState({ isPoster: false, userId: ME, job: open, myApplication: null, posterFirst: "Lexi", offeredToMe: true }), "see_offer", "Lexi offered you this job"],
    ["applied, waiting", run(open, { status: "pending", closed_reason: null }), "view_application", "You applied · Waiting on Lexi"],
    ["offered to me", run({ status: "accepted", helper_id: ME, helper_confirmed_at: null }, { status: "pending", closed_reason: null }), "see_offer", null],
    ["hired", run({ status: "accepted", helper_id: ME, helper_confirmed_at: "t" }, { status: "accepted", closed_reason: null }), "open_working", null],
    ["declined", run(open, { status: "rejected", closed_reason: null }), "none", "Not selected this time"],
    ["job cancelled", run({ status: "cancelled", helper_id: null }, { status: "rejected", closed_reason: "job_cancelled" }), "none", "This job is no longer available"],
    ["filled by someone else", run({ status: "accepted", helper_id: "other", helper_confirmed_at: "t" }, { status: "pending", closed_reason: null }), "none", "This job is no longer available"],
    ["closed, never applied", run({ status: "completed", helper_id: "other" }, null), "none", "This job is no longer available"],
    ["own job", run(open, null, true), "manage", null],
    // A2-B8: a crew job's helper_id is null; the roster (group_job_helpers) says the viewer is hired.
    ["on a crew (helper_id null)", jobPageViewerState({ isPoster: false, userId: ME, job: { status: "in_progress", helper_id: null }, myApplication: { status: "accepted", closed_reason: null }, posterFirst: "Lexi", onCrew: true }), "open_working", null],
  ];
  it.each(table)("%s", (_name, got, kind, status) => {
    expect(got.action.kind).toBe(kind);
    expect(got.status).toBe(status);
  });
  it("A2-B8: the page's data hook reads the viewer's OWN roster row on a crew job and hands it to the page", () => {
    const hook = blankComments(readFileSync(resolve(__dirname, "useJobPage.ts"), "utf8"));
    expect(hook.length).toBeGreaterThan(1000);
    expect(hook).toContain('.from("group_job_helpers").select("id").eq("job_id", jobId).eq("helper_id", userId)');
    expect(hook).toMatch(/enabled: !!job\.data && !isPoster && !!userId && job\.data\.job\.is_group_job === true/);
    expect(hook).toContain("onCrew: onCrew.data === true }");
  });
  it("an applied member is never offered Apply", () => {
    expect(table.filter(([n]) => n !== "not applied, open").every(([, g]) => g.action.kind !== "apply")).toBe(true);
  });
});
