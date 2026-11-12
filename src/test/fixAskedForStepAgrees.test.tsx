/**
 * Q2668 (audit 1102e row 1, HIGH): "Fix asked for", Helpr side. The step line said "You marked it done. Lexi has
 * until Tue 4:58 AM to check it" (helper_completed_at + the review window) while the What to fix box said "Send the
 * fix by Tue 4:28 AM" (revision_deadline), and the page had no button to say the fix was done. The poster's line still
 * read "Next: approve Eli's work". Now the step line, the box and the button agree, with ONE deadline from the server:
 *  - fix owed (revision_completed_at null): Helpr "Next: fix it and mark it done · by <revision_deadline>" with a
 *    primary "Mark it done" (create-payment resolve_revision); poster "Waiting on Eli's fix · by <revision_deadline>";
 *  - fix sent (revision_completed_at set): Helpr "You sent the fix. Lexi has until <revision_acceptance_deadline> to
 *    check it"; poster "Eli sent the fix. Check it and approve".
 *
 * @mutate src/components/tracker/jobProgressState.ts |   if (status === "revision_requested") return revisionLine(job, poster, other, held); |
 * @mutate src/components/tracker/jobProgressState.ts | atBy(6, !poster, "Working", text, `by ${when(due)}`, held); | atBy(6, !poster, "Working", text, `by ${when(due - 30 * 60_000)}`, held);
 * @mutate src/components/job-card/activityFilters.ts |   if (j.revision_completed_at && Date.parse(j.revision_completed_at) >= sentBack) return false; |
 * @mutate src/pages/jobs/jobPage/hiredHelprFace.ts |   if (fixOwed && o.markFixDone) return | if (false) return
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx | {side === "poster" ? "The fix is due by" : "Fix it and mark it done by"} | {side === "poster" ? "The fix is due by" : "Send the fix by"}
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | , revision_requested_at, revision_completed_at, revision_acceptance_deadline"; | ";
 */
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jobProgress, type ProgressJob } from "@/components/tracker/jobProgressState";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import { nextStepWords } from "@/lib/nextStepWords";
import type { JobPageRow } from "@/pages/jobs/jobPage/useJobPage";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { RevisionAsk } from "@/pages/jobs/jobPage/JobPageParts";
import { hiredHelprFace } from "@/pages/jobs/jobPage/hiredHelprFace";

const NOW = new Date("2037-10-21T15:00:00Z"); // Wed 10:00 AM in Louisiana
const DUE = "2037-10-23T09:28:00Z"; // Fri 4:28 AM in Louisiana (revision_deadline, set by the server)
const CHECK_BY = "2037-10-24T15:00:00Z"; // Sat 10:00 AM (revision_acceptance_deadline, set by resolve_revision)

const job: ProgressJob & Partial<JobPageRow> = {
  id: "j1", status: "revision_requested", helper_id: "h", customer_id: "p", payment_status: "escrow",
  date_needed: "2037-10-20", start_time: "09:00", helper_confirmed_at: "2037-10-18T12:00:00Z", helper_dayof_confirmed_at: "2037-10-19T12:00:00Z",
  poster_confirmed_at: "2037-10-19T13:00:00Z", helper_on_the_way_at: "2037-10-20T13:30:00Z", helper_arrived_at: "2037-10-20T14:00:00Z",
  poster_confirmed_working_at: "2037-10-20T14:05:00Z", helper_completed_at: "2037-10-20T09:58:00Z",
  revision_requested_at: "2037-10-20T10:28:00Z", revision_deadline: DUE, revision_note: "The back gate area was missed.",
} as ProgressJob & Partial<JobPageRow>;
const sent = { ...job, revision_completed_at: "2037-10-21T14:00:00Z", revision_acceptance_deadline: CHECK_BY };

const line = (j: ProgressJob, viewer: "poster" | "helpr") => {
  const otherFirst = viewer === "poster" ? "Eli" : "Lexi";
  const p = jobProgress(j, { viewer, otherFirst, now: NOW, workUnderway: true, tracking: { status: "working" } });
  const step = jobNextStep(p, { side: viewer, otherFirst });
  return { p, words: step ? `${step.who === "you" ? "Next: " : ""}${step.text}${step.by ? ` · ${step.by}` : ""}` : "", plain: step ? nextStepWords(step) : "" };
};

const face = (j: ProgressJob & Partial<JobPageRow>, markFixDone?: () => void) =>
  hiredHelprFace(j as unknown as JobPageRow, { userId: "h", posterFirst: "Lexi", trackingStatus: "working", open: () => {}, message: () => {}, markFixDone, application: { status: "accepted", closed_reason: null } });

describe("Fix asked for: the step line, the box and the button agree (Q2668)", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });
  afterEach(cleanup);

  it("the Helpr's step is the fix, by the server's revision_deadline, never 'You marked it done'", () => {
    const h = line(job, "helpr");
    expect(h.p.waitingOnYou).toBe(true);
    expect(h.words).toBe("Next: Fix it and mark it done · by Fri 4:28 AM");
    expect(h.words).not.toMatch(/has until|You marked it done/);
  });

  it("the poster waits on the fix, by the same deadline, never 'approve' while it is owed", () => {
    const p = line(job, "poster");
    expect(p.p.waitingOnYou).toBe(false);
    expect(p.words).toBe("Waiting on Eli's fix · by Fri 4:28 AM");
    expect(p.words).not.toMatch(/[Aa]pprove/);
  });

  it("the box names the same deadline as the step line", () => {
    const t = render(<RevisionAsk job={job as unknown as JobPageRow} side="helpr" posterFirst="Lexi" />).container.textContent ?? "";
    expect(t).toContain("Fix it and mark it done by Fri, Oct 23, 4:28 AM.");
    cleanup();
    const p = render(<RevisionAsk job={job as unknown as JobPageRow} side="poster" />).container.textContent ?? "";
    expect(p).toContain("The fix is due by Fri, Oct 23, 4:28 AM.");
    cleanup();
    // Fix sent: no deadline left to meet in the box (the step line says who checks it, by when).
    const s = render(<RevisionAsk job={sent as unknown as JobPageRow} side="helpr" posterFirst="Lexi" />).container.textContent ?? "";
    expect(s).not.toContain("by Fri, Oct 23");
  });

  it("the Helpr's page button is a primary 'Mark it done' while the fix is owed, and it marks the fix done", () => {
    const mark = vi.fn();
    const f = face(job, mark);
    expect(f).toMatchObject({ label: "Mark it done", tone: "primary" });
    f!.onClick();
    expect(mark).toHaveBeenCalledTimes(1);
    expect(face(sent, mark)?.label).not.toBe("Mark it done");
  });

  it("fix sent: the Helpr waits on the poster's check (revision_acceptance_deadline); the poster checks it", () => {
    const h = line(sent, "helpr");
    expect(h.p.waitingOnYou).toBe(false);
    expect(h.words).toBe("You sent the fix. Lexi has until Sat, Oct 24 at 10:00 AM to check it");
    const p = line(sent, "poster");
    expect(p.p.waitingOnYou).toBe(true);
    expect(p.words).toMatch(/^Next: Approve Eli's work/);
  });

  it("the page reads the three revision stamps and wires the button", () => {
    const hook = readFileSync(resolve(__dirname, "../pages/jobs/jobPage/useJobPage.ts"), "utf8");
    const party = (hook.match(/const PARTY_COLUMNS =\s*"([^"]+)"/)?.[1] ?? "").split(/,\s*/);
    expect(party.length).toBeGreaterThan(20);
    expect(party).toEqual(expect.arrayContaining(["revision_requested_at", "revision_completed_at", "revision_acceptance_deadline", "revision_deadline"]));
    const page = blankComments(readFileSync(resolve(__dirname, "../pages/jobs/jobPage/JobPage.tsx"), "utf8"));
    expect(page).toMatch(/markFixDone: /);
  });
});
