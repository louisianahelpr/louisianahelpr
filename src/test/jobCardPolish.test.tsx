/**
 * JOB CARD POLISH (owner, 2026-10-23, picked from ~/.lh-wt/card-polish-critique.md: items 1, 2, 3, 5-15). Each
 * test is one item; each reads the real card function or renders the real piece.
 *  1  a confirm is owed -> the face button IS the confirm (through the card's own dialog: faceActionRequest)
 *  2  past the day -> the line's own action (Report no-show / Cancel job)
 *  3  "I'm on my way" on the face from 3 hours before the start
 *  5  waiting lines say what is next and by when
 *  6  in the confirm window the clock is the confirm deadline
 *  7  one clock at a time; more than 2 days out a date, not a timer
 *  8  no "Job time has arrived" days later
 *  9  the approve clock reads forwards
 *  10 filed where the line says (Waiting), and the Helpr's waiting group says "Waiting"
 *  11 the collapsed Helpr card's address on one line
 *  12 no caption word under the price (was "take-home"; owner 2026-10-25)
 *  13 a waiting card: "Message <name>" + a small "Manage job" link
 *  14 desktop: the price beside the title
 *  15 a dispute says "Dispute open · Payment on hold" and opens the dispute
 *
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts |       return { label: "I'm still on", onClick: h.confirm, tone: "primary" }; |       return { label: "Manage job", onClick: h.manage, tone: "secondary" };
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts |       return { label: "Report no-show", onClick: h.noShow, tone: "secondary" }; |       return { label: "Manage job", onClick: h.manage, tone: "secondary" };
 * @mutate src/pages/jobs/appliedJobCard/helperFaceAction.ts |     if (start && start.getTime() - Date.now() > ON_MY_WAY_LEAD_MS) return null; |
 * @mutate src/components/job-card/jobStatusLine.ts |     if (!job.date_needed \|\| Date.now() < confirmOpensMs(job.date_needed)) return `${f} accepted · confirms the day before`; |     if (true) return `${f} accepted`;
 * @mutate src/components/job-card/jobStatusLine.ts |     case "confirm_still_on":\n      return confirmDeadline(job); |     case "confirm_still_on":\n      return null;
 * @mutate src/components/job-card/collapsedClocks.ts |   if (opens) return [{ ...opens.clock, farLabel: "Confirm opens" }]; |   if (opens) return [{ ...opens.clock }];
 * @mutate src/components/job-card/collapsedClocks.ts |   if (!start \|\| Date.now() - start.getTime() > PAST_START_DROP_MS) return []; |   if (!start) return [];
 * @mutate src/lib/activityBuckets.ts |   waiting: "Waiting",\n  scheduled: "Booked", |   waiting: "Applied",\n  scheduled: "Booked",
 * @mutate src/components/job-card/activityFilters.ts |     if (app.job?.helper_arrived_at && !arrivalEstablished(app.job) && !beforePhotoIsThePrimary(app.job)) return "waiting"; |
 * @mutate src/components/job-card/JobCardMetaRow.tsx |   const wrapAddress = fullAddress && !oneLine; |   const wrapAddress = fullAddress;
 * @mutate src/components/job-card/JobCardMetaRow.tsx |   const cityFlex = wrapAddress | const cityFlex = fullAddress
 * @mutate src/components/job-card/JobStatusStrip.tsx |         {variant === "line" && line.tone === "alarm" ? `${line.eyebrow} · ${line.detail}` : line.detail} |         {line.detail}
 * @mutate src/components/job-card/JobStatusStrip.tsx |   const rowClocks = line.deadline && !deadlineInline ? null : extraClocks; |   const rowClocks = extraClocks;
 * @mutate src/components/job-card/JobStatusStrip.tsx |   const rowClocks = line.deadline && !deadlineInline ? null : extraClocks; |   const rowClocks = line.deadline ? null : extraClocks;
 */
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { posterFaceAction } from "@/pages/posts/postedJobCard/posterFaceAction";
import { helperFaceAction, helperFaceNextStep, ON_MY_WAY_LEAD_MS } from "@/pages/jobs/appliedJobCard/helperFaceAction";
import { requestFaceAction, takeFaceAction } from "@/components/job-card/faceActionRequest";
import { posterStatusLine, helperStatusLine } from "@/components/job-card/jobStatusLine";
import { collapsedClocks } from "@/components/job-card/collapsedClocks";
import { postedActivityBucket, appliedActivityBucket } from "@/components/job-card/activityFilters";
import { WORKING_GROUP_LABEL } from "@/lib/activityBuckets";
import { JobCardMetaRow } from "@/components/job-card/JobCardMetaRow";
import { JobStatusStrip } from "@/components/job-card/JobStatusStrip";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));
const NOW = new Date("2037-10-21T15:00:00Z"); // Wed 10:00 AM Louisiana
const T = "2037-10-20T15:00:00Z";
const noop = () => {};
const handlers = (over: Partial<Record<string, () => void>> = {}) => ({
  pendingApplicants: 0, helperName: "Hallie H.", confirmingArrival: false, completing: false,
  openApplicants: noop, confirmArrival: noop, approve: noop, review: noop, tip: noop, postAgain: noop, message: noop, manage: noop,
  confirm: noop, noShow: noop, cancel: noop, viewDispute: noop, ...over,
});
const job = (j: Partial<Job> & Record<string, unknown>) => ({ id: "j", status: "accepted", helper_id: "h", customer_id: "p", payment_status: "escrow", date_needed: "2037-10-22", start_time: "15:00:00", helper_confirmed_at: T, ...j }) as unknown as Job;

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterAll(() => { vi.useRealTimers(); });
afterEach(cleanup);

describe("job card polish (owner 2026-10-23)", () => {
  it("1: a confirm owed is the face's button, through the card's own dialog (one-shot request)", () => {
    const confirm = vi.fn();
    expect(posterFaceAction("confirm_still_on", job({}), handlers({ confirm }))).toMatchObject({ label: "I'm still on", tone: "primary" });
    const helper = helperFaceAction({ isMinimalCard: false, isOffered: false, owesReview: false, review: noop, manage: noop, open: noop, wait: "confirm_day", jobId: "j" });
    expect(helper).toMatchObject({ label: "Confirm you'll be at the job", tone: "primary", step: "confirm" });
    helper!.onClick();
    expect(takeFaceAction("other", "confirm")).toBe(false);
    expect(takeFaceAction("j", "confirm")).toBe(true);
    expect(takeFaceAction("j", "confirm")).toBe(false);
    requestFaceAction("k", "confirm");
    vi.setSystemTime(new Date(NOW.getTime() + 11_000));
    expect(takeFaceAction("k", "confirm")).toBe(false);
    vi.setSystemTime(NOW);
    // The control that owns the confirm opens its own dialog on the request.
    expect(code("src/components/JobConfirmation.tsx")).toMatch(/if \(owed && \(openNow \|\| takeFaceAction\(jobId, "confirm"\)\)\) setShowConfirmDialog\(true\);/);
  });

  it("2: past the day the line's own action; 15: a dispute opens the dispute", () => {
    expect(posterFaceAction("overdue_no_show", job({}), handlers()).label).toBe("Report no-show");
    for (const w of ["overdue_unhired", "overdue_unconfirmed", "overdue_not_started", "overdue_not_arrived"] as const) {
      expect({ w, label: posterFaceAction(w, job({}), handlers()).label }).toEqual({ w, label: "Cancel job" });
    }
    expect(posterFaceAction("dispute", job({}), handlers()).label).toBe("Open the dispute");
    expect(helperFaceAction({ isMinimalCard: false, isOffered: false, owesReview: false, review: noop, manage: noop, wait: "dispute", viewDispute: noop })?.label).toBe("Open the dispute");
  });

  it("3: 'I'm on my way' on the face from 3 hours before the start, not a day early", () => {
    expect(ON_MY_WAY_LEAD_MS).toBe(3 * 60 * 60 * 1000);
    const confirmed = { id: "j", status: "accepted", helper_dayof_confirmed_at: T, start_time: "15:00:00" };
    expect(helperFaceNextStep({ ...confirmed, date_needed: "2037-10-22" }, null)).toBeNull(); // 29h out
    expect(helperFaceNextStep({ ...confirmed, date_needed: "2037-10-21", start_time: "12:00:00" }, null)?.label).toBe("I'm on my way"); // 2h out
    expect(helperFaceNextStep({ ...confirmed, date_needed: "2037-10-12" }, null)?.label).toBe("I'm on my way"); // past
  });

  it("5: waiting lines say what is next and by when; 6: the confirm window's clock is the confirm deadline", () => {
    const line = (j: Partial<Job>) => posterStatusLine(job(j), 0, NOW, undefined, false, "Hallie H.");
    expect(line({ date_needed: "2037-11-12" }).detail).toBe("Hallie accepted · confirms the day before");
    expect(line({ poster_confirmed_at: T }).detail).toMatch(/^Waiting on Hallie to confirm by Thu 1:00 PM$/);
    expect(line({ poster_confirmed_at: T, helper_dayof_confirmed_at: T }).detail).toBe("Hallie confirmed · taps On my way when leaving");
    const owed = line({});
    expect(owed.id).toBe("confirm_still_on");
    expect(owed.deadline).toMatchObject({ source: "confirm_deadline", consequenceText: "left to confirm" });
    const app = { id: "a", job: job({}), helper_id: "h", status: "accepted", closed_reason: null } as unknown as AppliedApp;
    expect(helperStatusLine(app).deadline).toMatchObject({ source: "confirm_deadline" });
  });

  it("7: one clock, the next one, as a date when more than 2 days out; 8: none days after the start", () => {
    const far = collapsedClocks({ date_needed: "2037-11-12", start_time: "15:00:00", status: "accepted", helper_confirmed_at: T }, true);
    expect(far).toHaveLength(1);
    expect(far[0]).toMatchObject({ farLabel: "Confirm opens" });
    const soon = collapsedClocks({ date_needed: "2037-10-22", start_time: "15:00:00", status: "accepted", helper_confirmed_at: T }, true);
    expect(soon.map((c) => c.id)).toEqual(["start"]);
    expect(collapsedClocks({ date_needed: "2037-10-12", start_time: "15:00:00", status: "accepted", helper_confirmed_at: T }, true)).toEqual([]);
    // A line whose own clock is a row (the confirm deadline) shows that row alone, not the start under it too.
    const startRow = soon;
    const confirmLine = posterStatusLine(job({ helper_dayof_confirmed_at: null }), 0, NOW);
    expect(confirmLine.deadline).toBeTruthy();
    const { container, unmount } = render(<JobStatusStrip line={confirmLine} extraClocks={startRow} variant="line" />);
    expect(container.querySelectorAll("[data-countdown-row]")).toHaveLength(0);
    expect(container.textContent).toMatch(/left to confirm/);
    expect(container.textContent).not.toMatch(/until the job starts/);
    unmount();
    // An answer clock riding the sentence keeps the start row under it (owner, 2026-10-08: two lines).
    const offer = posterStatusLine(job({ helper_confirmed_at: null, response_deadline: "2037-10-21T18:00:00Z" }), 0, NOW, undefined, false, "Hallie");
    expect(offer.id).toBe("unconfirmed");
    const two = render(<JobStatusStrip line={offer} extraClocks={startRow} variant="line" />);
    expect([...two.container.querySelectorAll("[data-countdown-row]")].map((r) => r.getAttribute("data-countdown-row"))).toEqual(["start"]);
  });

  it("9: the approve clock reads forwards", () => {
    const line = posterStatusLine(job({ status: "in_progress", helper_on_the_way_at: T, helper_arrived_at: T, poster_confirmed_arrival_at: T, helper_completed_at: T }), 0, NOW);
    // Reads forwards ("2h 6m left to review", one line on a card at 375, owner 2026-10-25; when it runs out the line
    // says "Helpr support is stepping in"); since payout-after-approval (owner 2026-10-23) nothing pays automatically,
    // so the clock never promises a release.
    expect(line.deadline?.consequenceText).toBe("left to review");
    expect(line.deadline?.expiredText).toBe("Helpr support is stepping in");
    expect(line.deadline?.consequenceText).not.toMatch(/automatic/);
  });

  it("10: filed where the line says, and the Helpr's waiting group says Waiting", () => {
    expect(WORKING_GROUP_LABEL.waiting).toBe("Waiting");
    expect(postedActivityBucket(job({ poster_confirmed_at: T }), 0, NOW)).toBe("waiting");
    const arrived = job({ status: "in_progress", require_photo_proof: false, helper_on_the_way_at: T, helper_arrived_at: T, date_needed: "2037-10-21" });
    expect(appliedActivityBucket({ id: "a", job: arrived, helper_id: "h", status: "accepted", closed_reason: null } as unknown as AppliedApp)).toBe("waiting");
  });

  it("11: the collapsed Helpr card's full address stays on one line", () => {
    const { container } = render(
      <MemoryRouter>
        <JobCardMetaRow dateNeeded="2037-10-22" startTime="15:00:00" location="4412 Highland Rd, Baton Rouge, LA 70808" showFullAddress oneLine />
      </MemoryRouter>,
    );
    expect(container.querySelector(".job-meta-row")?.className).toContain("flex-nowrap");
    // The street on the line, the whole address in the place control's title (owner-approved item 11).
    expect(container.textContent).toContain("4412 Highland Rd");
    expect(container.querySelector('[title="4412 Highland Rd, Baton Rouge, LA 70808"]') ?? container.querySelector('[aria-label*="4412 Highland Rd, Baton Rouge, LA 70808"]')).toBeTruthy();
    expect(container.querySelector(".whitespace-normal")).toBeNull();
    // The address gives way; date and time stay on the line (the first cut pushed them out, looked 2026-10-23).
    expect(container.querySelector(".basis-full")).toBeNull();
    expect(container.textContent).toMatch(/3:00 PM/);
  });

  it("12: no caption word under the price (owner 2026-10-25); 14: desktop price beside the title", () => {
    expect(code("src/pages/jobs/AppliedJobCard.tsx")).not.toMatch(/moneyCaption|take-home"/);
    const face = code("src/components/job-card/MineJobFace.tsx");
    expect(face).not.toMatch(/moneyCaption/);
    expect(face).toContain('className="flex items-start justify-between gap-3 md:justify-start md:gap-4"');
  });

  it("13: a waiting card messages the other person; Manage job is a small link beside it", () => {
    const a = posterFaceAction("confirmed", job({}), handlers());
    expect(a).toMatchObject({ label: "Message Hallie", tone: "secondary", also: { label: "Manage job" } });
    expect(posterFaceAction("no_applicants", job({ helper_id: null, status: "open" }), handlers()).label).toBe("Manage job");
    const h = helperFaceAction({ isMinimalCard: false, isOffered: false, owesReview: false, review: noop, manage: noop, message: { name: "Pat", onClick: noop } });
    expect(h).toMatchObject({ label: "Message Pat", also: { label: "Manage job" } });
    expect(code("src/components/job-card/MineJobFace.tsx")).toContain('data-mine-face-also=""');
  });

  it("15: a dispute's face line says so", () => {
    const line = posterStatusLine(job({ status: "disputed" }), 0, NOW);
    const { container } = render(<JobStatusStrip line={line} variant="line" />);
    expect(container.textContent).toContain("Dispute open · Payment on hold");
  });
});
