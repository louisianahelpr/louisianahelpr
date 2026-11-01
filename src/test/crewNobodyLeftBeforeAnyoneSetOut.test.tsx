/**
 * A3-31 (audit 11-01, Medium): EVERY CREW MEMBER A NO-SHOW BEFORE ANYONE SET OUT. The crew turns in_progress only
 * when a member taps "on my way" or checks in (rpc_group_member_on_the_way / rpc_group_member_mark_arrival). If every
 * member is reported a no-show, nobody set out, the job stays "accepted", and crewNobodyLeft (which read only
 * in_progress) was false: the page said "Your crew is booked", the roster said "hire from your applicants before the
 * start" after the start, and the "Nobody from your crew came. Cancel and get a refund" block never showed. The job
 * page also never handed GroupJobHelpers its cancel, so the block could not show there at all.
 *
 * Now an accepted crew whose start has passed and whose roster names nobody is the same case. The server needs no
 * change: poster_cancel_job accepts 'accepted' and prices an empty roster at fee 0 with no strike (pinned in
 * crewAllNoShowCanCancel.test.tsx, "the server" block).
 *
 * @mutate src/lib/crewLifecycle.ts |   const underWay = jobStatus === "in_progress" \|\| (jobStatus === "accepted" && started); |   const underWay = jobStatus === "in_progress";
 * @mutate src/components/GroupJobHelpers.tsx |   const nobodyLeft = isOwner && !!onCancelJob && crewNobodyLeft(jobStatus, helpers, rosterKnown, started); |   const nobodyLeft = isOwner && !!onCancelJob && crewNobodyLeft(jobStatus, helpers, rosterKnown);
 * @mutate src/components/GroupJobHelpers.tsx |           {jobStatus === "accepted" && !started |           {jobStatus === "accepted"
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |                 onCancelJob={posterFlows.cancel} |                 data-x=""
 * @mutate src/pages/jobs/jobPage/usePosterPageFlows.tsx | ?? [], true, hasJobStarted(job.date_needed, job.start_time)), | ?? [], true),
 * @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts | crewNobodyLeft: crewNobodyLeft(job.status, [], true, hasJobStarted(job.date_needed, job.start_time)) | crewNobodyLeft: job.status === "in_progress"
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => {
  const pending = { select: () => pending, eq: () => new Promise(() => {}) };
  return { supabase: { from: vi.fn(() => pending), rpc: vi.fn() } };
});
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticMedium: vi.fn() }));

const { GroupJobHelpers } = await import("@/components/GroupJobHelpers");
const { crewNobodyLeft } = await import("@/lib/crewLifecycle");

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("crewNobodyLeft: an accepted crew after its start", () => {
  it("is nobody-left once the start has passed", () => {
    expect(crewNobodyLeft("accepted", [], true, true)).toBe(true);
    expect(crewNobodyLeft("accepted", [{ helper_id: null }], true, true)).toBe(true);
  });
  it.each([
    ["before the start", "accepted", [], true, false],
    ["with a member still on the roster", "accepted", [{ helper_id: "m1" }], true, true],
    ["while the roster is loading", "accepted", [], false, true],
    ["on an open job", "open", [], true, true],
    ["on a finished job", "completed", [], true, true],
  ] as const)("not %s", (_w, status, roster, known, started) => {
    expect(crewNobodyLeft(status, roster, known, started)).toBe(false);
  });
});

describe("the roster on an accepted crew nobody came to", () => {
  const view = (dateNeeded: string, initialHelpers: Array<Record<string, unknown>> = []) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <GroupJobHelpers jobId="j" helpersNeeded={2} isOwner jobStatus="accepted" initialHelpers={initialHelpers as never}
          dateNeeded={dateNeeded} startTime="09:00" onCancelJob={vi.fn()} />
      </QueryClientProvider>,
    );
  const button = () => screen.queryByRole("button", { name: "Cancel and get a refund" });

  it("after the start: offers the refund cancel, and never 'hire before the start'", () => {
    view("2020-01-06");
    expect(button()).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("before the start");
  });
  it("before the start: no cancel block, and the open spots can still be filled", () => {
    view("2032-10-30");
    expect(button()).not.toBeInTheDocument();
    expect(document.body.textContent).toContain("hire from your applicants before the start");
  });
  it("after the start with one member still on: no cancel block, and no 'before the start' line", () => {
    view("2020-01-06", [{ id: "s1", helper_id: "m1", status: "accepted", helperName: "Remy", helper_confirmed_at: "2019-12-30T12:00:00Z" }]);
    expect(button()).not.toBeInTheDocument();
    expect(document.body.textContent).toContain("1 spot open. Most of that share comes back to you after the job.");
  });
});

describe("the wiring", () => {
  it("reads real source files", () => {
    for (const f of ["src/pages/jobs/jobPage/JobPage.tsx", "src/pages/jobs/jobPage/usePosterPageFlows.tsx", "src/components/job-card/activityActions/useLifecycleHandlers.ts"]) {
      expect(src(f).length).toBeGreaterThan(2000);
    }
  });
  it("the job page hands the roster its cancel", () => {
    expect(src("src/pages/jobs/jobPage/JobPage.tsx")).toContain("onCancelJob={posterFlows.cancel}");
  });
  it("the job page flows and the cancel dialog pass the start", () => {
    expect(src("src/pages/jobs/jobPage/usePosterPageFlows.tsx")).toContain("crewNobodyLeft(job.status, detail.groupHelpersByJob?.[job.id] ?? [], true, hasJobStarted(job.date_needed, job.start_time))");
    expect(src("src/components/job-card/activityActions/useLifecycleHandlers.ts")).toContain("crewNobodyLeft: crewNobodyLeft(job.status, [], true, hasJobStarted(job.date_needed, job.start_time))");
  });
});
