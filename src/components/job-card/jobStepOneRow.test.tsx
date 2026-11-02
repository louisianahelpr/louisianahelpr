import { afterEach, describe, it, expect, vi, beforeAll } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { AppliedApp, Job } from "./activityConstants";
import type { PosterStepCtx } from "../../pages/posts/postedJobCard/steps/posterStepContract";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

// @mutate src/pages/posts/postedJobCard/steps/ScheduledStep.tsx | primary={<JobStepPrimaryButton icon={MessageSquare} | primary={false && <JobStepPrimaryButton icon={MessageSquare}
// @mutate src/components/JobConfirmation.tsx |     if (variant === "inline" && isOwner) { |     if (false) {
// @mutate src/components/JobConfirmation.tsx |           label={newSlot ? "Confirm" : isHelper ? HELPER_CONFIRM_LABEL : "I'm still on"} |           label={isHelper ? HELPER_CONFIRM_LABEL : "I'm still on"}
// @mutate src/components/JobConfirmation.tsx |       {isOwner ? `Confirm the new time, ${newSlot}` : `Confirm you'll be there ${newSlot}`} |       {isOwner ? `Confirm the new time` : `Confirm you'll be there`}
// @mutate src/components/JobConfirmation.tsx |     ? `Waiting for ${otherFirstName \|\| "your Helpr"} to confirm ${newSlot}` |     ? `Waiting for ${otherFirstName \|\| "your Helpr"} to confirm`
// @mutate src/components/job-card/JobStepCard.tsx |           {moreChips.length > 1 ? ( |           {moreChips.length > 0 ? (
/**
 * VN-21 — EVERY BUTTON ON A STEP CARD SITS ON ONE ROW (owner, 2026-09-14).
 *
 * "i don't think i like the multiple rows of buttons for jobs and posts. can
 * all the buttons be on 1 row" — then "all buttons should be with the live
 * tracker box", and on the Posts side "confirm they're working, no show,
 * message etc — all of these buttons need to be on 1 line not multiple".
 *
 * The shell (JobStepCard) used to draw a full-width `primary`, then a chip
 * grid, and the tracker drew its own full-width CTA inside the header — three
 * stacked rows on a Working card. This file renders every step of BOTH cards
 * and fails if any action control lives outside the step's single
 * `[data-job-step-row]`, if there is more than one row, or if that row is
 * allowed to wrap.
 *
 * "Action control" is every button or link the card renders, minus the things
 * that are content rather than the card's moves: the inline dispute-response
 * form (it IS the ask, opened from the row), and dialogs (portalled, closed).
 */

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
// Uploaders and proof galleries are content (the `ask`), not the row's moves.
vi.mock("@/components/PhotoProof", async () => ({
  PhotoProofGroup: () => <div data-testid="photo-proof" />,
  // The gallery the step cards' `Photos` chip opens (owner item 10). Closed,
  // portalled and contributing no control — stubbed to nothing so the row's
  // own count is unaffected either way.
  PhotoProofDialog: () => null,
  PhotoProofRequirementNote: () => null,
  // THE CAPTURE CONTROL, which now lives IN the row (owner, 2026-09-19:
  // "before and after buttons should also be on the same lines as the other
  // buttons"). NOT stubbed to null: it is one of the row's controls and the
  // per-case floors below count it.
  // asPrimary: the real one draws "Take <label>" (photoPrimaryLabel) as the row's glossy primary.
  PhotoProofCaptureChip: await (async () => {
    const { photoPrimaryLabel } = await import("@/components/job-card/photoPrimaryLabel");
    return ({ label, asPrimary }: { label: string; asPrimary?: boolean }) =>
      asPrimary ? <button type="button" className="btn-grad-primary">{photoPrimaryLabel(label)}</button> : <button type="button">{label}</button>;
  })(),
}));

function makeSupabase() {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  const methods = [
    "from", "select", "eq", "neq", "in", "order", "limit", "insert", "update",
    "upsert", "delete", "gte", "lte", "is", "not", "filter",
  ];
  for (const m of methods) chain[m] = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
}
vi.mock("@/integrations/supabase/client", () => makeSupabase());
// A date/time moved by an accepted change (owner, 2026-10-21): the cases below that need it set RESCHEDULED.v.
const RESCHEDULED = vi.hoisted(() => ({ v: false }));
vi.mock("@/hooks/useJobRescheduled", () => ({ useJobRescheduled: () => RESCHEDULED.v }));
afterEach(() => { RESCHEDULED.v = false; });

import { ActiveJobSection } from "../../pages/jobs/appliedJobCard/ActiveJobSection";
import { ConfirmedSection } from "../../pages/jobs/appliedJobCard/ConfirmedSection";
import { DisputedSection } from "../../pages/jobs/appliedJobCard/DisputedSection";
import { InProgressStep } from "../../pages/posts/postedJobCard/steps/InProgressStep";
import { ScheduledStep } from "../../pages/posts/postedJobCard/steps/ScheduledStep";
import { OpenStep } from "../../pages/posts/postedJobCard/steps/OpenStep";
import { CompletedStep } from "../../pages/posts/postedJobCard/steps/CompletedStep";
import { DisputedStep } from "../../pages/posts/postedJobCard/steps/DisputedStep";
import { JobStepCard } from "./JobStepCard";
import { JobStepRowSlot, shouldTightenJobStepRow, primaryRoomAfterTightening } from "./jobStepRow";
// The sweep's own copy, never a retyped copy of it (owner item 7).
import { STALLED_APPROVE_DISABLED_LABEL } from "../../../supabase/functions/_shared/stalledCompletion";
import { pinJobClock } from "@/test/helpers/pinJobClock";

pinJobClock();

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const HELPER = "helper-1";
const POSTER = "poster-1";
const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
// `date_needed` is the job's day IN AMERICA/CHICAGO — same doctrine as
// `jobClock` below, which this pair predates and contradicted. They were
// `new Date(...).toISOString().slice(0, 10)`, i.e. the UTC day, which after
// 19:00 Pacific names the NEXT Central day: "start already passed" became a
// start two hours in the future (so Cancel job was still correctly offered,
// four controls not three), and the stalled fixture became a job whose day is
// not over (so `completionStalled` was correctly false, three controls not
// four). Green all morning, red after 19:00 — the product was right both times.
const YESTERDAY = jobLocalDateISO(-1);
const TODAY = jobLocalDateISO(0);
/** Two days back, so the job's scheduled END (the end of its DAY) is past
 *  `STALLED_FIRST_AFTER_HOURS` at every hour of the clock. One day back is
 *  only stalled after 02:00 Central. */
const DAY_LONG_PAST = jobLocalDateISO(-2);

/**
 * A `date_needed` + `start_time` pair `h` hours from now, resolved in the JOB's
 * timezone.
 *
 * Every clock gate on these cards resolves in America/Chicago — `hasJobStarted`
 * → `jobLocalStartMs`, the tracker's two-hour unlock, the cancel RPC's own
 * `COALESCE(start_time,'00:00')` — so a fixture that wants "the start is still
 * an hour away" has to say so in that zone, not in the runner's. It is derived
 * from the clock rather than typed because there is no fixed wall-clock time
 * that is always in the future.
 */
function jobClock(h: number): { date: string; time: string } {
  const at = new Date(NOW + h * 3_600_000);
  return {
    date: at.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }),
    time: at.toLocaleTimeString("en-GB", {
      timeZone: "America/Chicago",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}
/** Starts in an hour: inside the tracker's 2h unlock, before the cancel gate. */
const STARTS_SOON = jobClock(1);

type J = Job & { revision_note?: string | null };

/** Both halves of the VN-33 arrival rule, so the tracker offers its next step
 *  rather than the legacy "Try my location again" retry. */
const VERIFIED = { helper_arrival_verified_at: ago(6), poster_confirmed_arrival_at: ago(6) };

function makeJob(over: Record<string, unknown>): J {
  return {
    id: "job-1",
    title: "Mow the lawn",
    description: "Front and back",
    location: "Lafayette, LA",
    customer_id: POSTER,
    helper_id: HELPER,
    budget: 100,
    category: "yard_work",
    date_needed: YESTERDAY,
    start_time: "09:00",
    latitude: null,
    longitude: null,
    proof_before_urls: ["before.jpg"],
    proof_after_urls: ["after.jpg"],
    helper_confirmed_at: ago(48),
    helper_dayof_confirmed_at: ago(30),
    poster_confirmed_at: ago(47),
    poster_confirmed_working_at: ago(8),
    helper_on_the_way_at: ago(7),
    helper_arrived_at: ago(6),
    helper_completed_at: null,
    poster_completed_at: null,
    revision_requested_at: null,
    revision_deadline: null,
    revision_completed_at: null,
    revision_acceptance_deadline: null,
    revision_note: null,
    status: "in_progress",
    ...over,
  } as unknown as J;
}

const makeApp = (job: Job) =>
  ({ id: "app-1", job_id: job.id, helper_id: HELPER, status: "accepted", created_at: ago(72), job }) as unknown as AppliedApp;

const tracking = (status: string) => ({
  id: "t-1", status, latitude: null, longitude: null, eta_minutes: null, updated_at: ago(5),
});

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const active = (job: J, trackingStatus: string) => () =>
  wrap(
    <ActiveJobSection
      app={makeApp(job)}
      job={job}
      status={job.status}
      userId={HELPER}
      initialTracking={tracking(trackingStatus)}
      completingJobId={null}
      onComplete={vi.fn()}
      onResolveRevision={vi.fn()}
      onOpenDispute={vi.fn()}
      navigate={vi.fn()}
    />,
  );

function posterCtx(job: Job): PosterStepCtx {
  return {
    job,
    userId: POSTER,
    helperNames: { [HELPER]: "Hallie H." },
    completedJobMeta: {},
    completingJobId: null,
    confirmingArrivalJobId: null,
    confirmingWorkingJobId: null,
    instantReleaseOn: false,
    navigate: vi.fn(),
    onBoost: vi.fn(),
    onEdit: vi.fn(),
    crewBooked: false,
    onCancel: vi.fn(),
    onComplete: vi.fn(),
    onNoShow: vi.fn(),
    onTip: vi.fn(),
    onReview: vi.fn(),
    onDispute: vi.fn(),
    onReport: vi.fn(),
    onViewDispute: vi.fn(),
    onConfirmArrival: vi.fn(),
    onConfirmWorking: vi.fn(),
    onActionComplete: vi.fn(),
    completionSheetOpen: false,
    setCompletionSheetOpen: vi.fn(),
    disputeActing: false,
    resolveConfirmOpen: false,
    setResolveConfirmOpen: vi.fn(),
    escalateConfirmOpen: false,
    setEscalateConfirmOpen: vi.fn(),
    escalateDispute: vi.fn(),
    resolveDisputeAndRelease: vi.fn(),
  };
}

const disputed = (job: J, respondingJobId: string | null = null) => () =>
  wrap(
    <DisputedSection
      app={makeApp(job)}
      job={job}
      userId={HELPER}
      initialTracking={null}
      navigate={vi.fn()}
      onViewDispute={vi.fn()}
      onRefresh={vi.fn()}
      disputeResponse=""
      setDisputeResponse={vi.fn()}
      respondingJobId={respondingJobId}
      setRespondingJobId={vi.fn()}
      submittingResponse={false}
      setSubmittingResponse={vi.fn()}
    />,
  );

/** Every state of both cards the owner can reach, by the screen they named. */
const CASES: Array<{
  name: string;
  render: () => ReturnType<typeof render>;
  /** Floor on the controls found, so a fixture that stops reaching its state
   *  cannot pass on an empty card. */
  minControls: number;
  /** CEILING, for the states whose point is that a control is ABSENT — a floor
   *  alone cannot fail when something comes back. */
  maxControls?: number;
  /** What the row's primary slot holds, in order ([] = no primary). */
  primary: string[];
  /** The primary is on screen but not tappable — the poster's confirmation
   *  ladder keeps its box visible in every state (owner, 2026-09-19). */
  primaryDisabled?: boolean;
  /** …and when it is a FINISHED box it wears the `done` tone instead of the
   *  glossy primary, so "already confirmed" cannot read as "broken button". */
  primaryDone?: boolean;
  /** A reason the card owes for a disabled primary, matched against the row's
   *  note slot. A dead control with no explanation is the defect. */
  note?: RegExp;
}> = [
  // ── /jobs, Helpr ──
  {
    /* THE START HAS NOT PASSED — and that is the whole state this case names.
       It was written `date_needed: TODAY, start_time: "00:00"`, which is a job
       whose start is already hours behind us; `ae6c80903` then (correctly)
       hid the Cancel job chip in exactly that window, because
       `helper_cancel_booking` REFUSES it there (`job_already_started`) and an
       offered control that the server refuses is a dead-end tap. The fixture
       had simply stopped reaching the state its own name describes, and the
       floor caught it: three controls, not four. The product is right; the
       clock in the fixture was wrong. Its companion below pins the other side
       of that same gate. */
    name: "Jobs · Confirmed (tracker CTA + Directions · Message · Cancel job)",
    render: () =>
      wrap(
        <ConfirmedSection
          app={makeApp(makeJob({}))}
          job={makeJob({
            status: "accepted", date_needed: STARTS_SOON.date, start_time: STARTS_SOON.time,
            helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_working_at: null,
          })}
          userId={HELPER}
          initialTracking={tracking("job_confirmed")}
          navigate={vi.fn()}
        />,
      ),
    minControls: 4,
    primary: ["I'm on my way"],
    primaryDisabled: false,
  },
  {
    /* THE SAME CARD PAST ITS START, so the pair states the rule rather than
       one side of it: `helper_cancel_booking` refuses a cancel once the
       scheduled start has passed (ae6c80903), so the chip is gone and the row
       is legitimately three controls. Without this case, a future change that
       hid Cancel EVERYWHERE would still pass the case above by accident of the
       clock. */
    name: "Jobs · Confirmed, start already passed (no Cancel job — the RPC would refuse it)",
    render: () =>
      wrap(
        <ConfirmedSection
          app={makeApp(makeJob({}))}
          job={makeJob({
            status: "accepted", date_needed: TODAY, start_time: "00:00",
            helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_working_at: null,
          })}
          userId={HELPER}
          initialTracking={tracking("job_confirmed")}
          navigate={vi.fn()}
        />,
      ),
    // Four since board 187 (e1b80db64a): "Running late" joins Message and
    // Directions in More on the job's day. Cancel job would make five.
    minControls: 4,
    maxControls: 4,
    primary: ["I'm on my way"],
  },
  {
    // Owner 2026-10-21 (lead ruling): before the day-before window, no greyed "Confirm you'll be at the job";
    // the primary is talking to the poster and the line says when confirming opens.
    name: "Jobs · Confirmed, before the confirm window (Message <poster>; says when confirming opens)",
    render: () =>
      wrap(
        <ConfirmedSection
          app={{ ...makeApp(makeJob({})), posterName: "Lexi L." } as unknown as AppliedApp}
          job={makeJob({
            status: "accepted", date_needed: jobClock(96).date, start_time: jobClock(96).time,
            helper_confirmed_at: ago(72), helper_dayof_confirmed_at: null,
            helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_working_at: null,
          })}
          userId={HELPER}
          initialTracking={tracking("confirmed")}
          navigate={vi.fn()}
        />,
      ),
    minControls: 2,
    primary: ["Message Lexi"],
    primaryDisabled: false,
  },
  {
    name: "Jobs · Confirmed, day-of confirmation still owed (I'm still on)",
    render: () =>
      wrap(
        <ConfirmedSection
          app={makeApp(makeJob({}))}
          job={makeJob({
            status: "accepted", date_needed: TODAY, start_time: "23:59",
            helper_confirmed_at: ago(72), helper_dayof_confirmed_at: null,
            helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_working_at: null,
          })}
          userId={HELPER}
          initialTracking={tracking("confirmed")}
          navigate={vi.fn()}
        />,
      ),
    minControls: 4,
    primary: ["Confirm you'll be at the job"],
  },
  {
    // Owner, 2026-10-21: the date moved after accept, so the Helpr confirms the NEW slot.
    name: "Jobs · Confirmed, date moved, day-of confirm owed (Confirm; names the new slot)",
    render: () => {
      RESCHEDULED.v = true;
      return wrap(
        <ConfirmedSection
          app={makeApp(makeJob({}))}
          job={makeJob({
            status: "accepted", date_needed: TODAY, start_time: "23:59",
            helper_confirmed_at: ago(72), helper_dayof_confirmed_at: null,
            helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_working_at: null,
          })}
          userId={HELPER}
          initialTracking={tracking("confirmed")}
          navigate={vi.fn()}
        />,
      );
    },
    minControls: 4,
    primary: ["Confirm"],
    primaryDisabled: false,
    note: /Confirm you'll be there [A-Z][a-z]{2} 11:59 PM/,
  },
  {
    name: "Jobs · On the way (I've arrived + Directions · Message · Report a Problem)",
    render: active(makeJob({ helper_arrived_at: null, poster_confirmed_working_at: null }), "on_the_way"),
    minControls: 4,
    primary: ["I've arrived"],
  },
  {
    // The fixture carries both proof photos, so the capture chip is absent —
    // the row is legitimately three. Its companion above pins the other side.
    // Q366: SOS is in the Helpr's row from arrival to completion, as on the
    // poster's card, so the ceiling counts it. SOS, Report a Problem and
    // Dispute now share the row's one More menu: Message · More · Start working.
    name: "Jobs · Arrived (Start working + Message · More with SOS and Report a Problem)",
    render: active(makeJob({ ...VERIFIED, poster_confirmed_working_at: null }), "arrived"),
    minControls: 3,
    maxControls: 3,
    primary: ["Start working"],
  },
  {
    /* THE UNVERIFIED ARRIVAL, WITH ONE CONTROL INSTEAD OF TWO.
       This case read ["Try my location again", "Start working"] — the tracker
       portalled both into the single primary slot, outline first so the glossy
       one stayed right-most (owner, 2026-09-16). Owner, 2026-09-19: the retry
       chip is removed and the pull-to-refresh gesture on My Jobs re-checks the
       arrival instead (src/lib/arrivalRefresh.ts).

       THE CASE IS KEPT, NOT DELETED, and its ceiling is what makes it worth
       keeping: this is still the state that used to draw an extra control, so
       `maxControls` fails the moment one comes back. The row is one control
       narrower here and nowhere else. */
    name: "Jobs · Arrived, unverified arrival (Start working alone — no retry chip)",
    render: active(makeJob({ poster_confirmed_working_at: null }), "arrived"),
    minControls: 3,
    maxControls: 3,
    primary: ["Start working"],
  },
  {
    // The pair singlePrimaryCta.test.tsx pinned at 2: the tracker's "Mark Job
    // Complete" above PayoutPrimary's identical one. The tracker's IS the
    // primary; PayoutPrimary stands down.
    name: "Jobs · Working (Mark it done + Message · Report a Problem)",
    render: active(makeJob({ ...VERIFIED }), "working"),
    minControls: 3,
    primary: ["Mark it done"],
  },
  {
    /* THE CAPTURE IS IN THE ROW NOW (owner, 2026-09-19: "before and after
       buttons should also be on the same lines as the other buttons"). It was
       a titled panel with a full-width "Add photo" button in the `ask` slot
       ABOVE the row — the block in the owner's screenshot. Four controls:
       Message · After photo · More (Report a Problem, Dispute and SOS) + the
       disabled primary. */
    name: "Jobs · Working, after photo still owed (photo first: Take after photo is the primary)",
    render: active(makeJob({ ...VERIFIED, proof_after_urls: [] }), "working"),
    minControls: 3,
    maxControls: 4,
    primary: ["Take after photo"],
  },
  {
    name: "Jobs · Submitted (Message · Report a Problem, no primary)",
    render: active(makeJob({ ...VERIFIED, helper_completed_at: ago(2) }), "done"),
    minControls: 2,
    primary: [],
  },
  {
    name: "Jobs · Revision (I'll fix it + Message)",
    render: active(
      makeJob({
        status: "revision_requested", helper_completed_at: ago(5), revision_requested_at: ago(3),
        revision_deadline: ahead(60), revision_note: "The back gate area was missed.",
      }),
      "working",
    ),
    minControls: 3,
    primary: ["I'll fix it"],
  },
  {
    name: "Jobs · Disputed, filed by the Helpr (Withdraw + Timeline · Message · Contact admin)",
    render: disputed(makeJob({ status: "disputed", dispute_status: "open", disputed_by: HELPER, dispute_reason: "x" })),
    minControls: 4,
    primary: ["Withdraw dispute"],
  },
  {
    name: "Jobs · Disputed, filed by the poster (Respond + Timeline · Message · Contact admin)",
    render: disputed(makeJob({ status: "disputed", dispute_status: "open", disputed_by: POSTER, dispute_reason: "x" })),
    minControls: 4,
    primary: ["Respond to dispute"],
  },
  // ── /posts, poster ──
  {
    name: "Posts · Open (Share · Boost · Edit · Cancel)",
    render: () => wrap(<OpenStep {...posterCtx(makeJob({ status: "open", helper_id: null, date_needed: "2099-01-01" }))} />),
    minControls: 4,
    primary: [],
  },
  {
    // NOTHING TO CONFIRM YET: NO BOX (owner decision Q1400, 2026-10-07). From
    // 2026-09-19 this state drew a disabled "Confirm they've arrived" with "once your
    // Helpr is at the job" under it; the owner ruled that dead primary-looking
    // box out from accept until the Helpr marks themselves arrived.
    // Owner, 2026-10-21: the primary is what this stage needs, "Message <Helpr>" (the Message chip stands down).
    name: "Posts · Scheduled, nothing to confirm yet (no arrival box; Message <Helpr> primary · Cancel)",
    render: () => wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", helper_on_the_way_at: null, helper_arrived_at: null }))} />),
    minControls: 2,
    primary: ["Message Hallie"],
  },
  // ── Posts · Accepted, owner 2026-10-21: each stage's primary is the action it needs, never a greyed
  //    future step ("Confirm they've arrived" before the Helpr is on the way was the bug). ──
  {
    name: "Posts · Offered, Helpr has not accepted yet (Message <Helpr> primary)",
    render: () => wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", helper_confirmed_at: null, helper_dayof_confirmed_at: null, poster_confirmed_at: null, helper_on_the_way_at: null, helper_arrived_at: null, date_needed: jobClock(72).date, start_time: jobClock(72).time }))} />),
    minControls: 2,
    primary: ["Message Hallie"],
    primaryDisabled: false,
  },
  {
    name: "Posts · Accepted, before the confirm window (Message <Helpr>; says when confirming opens)",
    render: () => wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", helper_dayof_confirmed_at: null, poster_confirmed_at: null, helper_on_the_way_at: null, helper_arrived_at: null, date_needed: jobClock(72).date, start_time: jobClock(72).time }))} />),
    minControls: 2,
    primary: ["Message Hallie"],
    primaryDisabled: false,
    note: /You and Hallie confirm the day before\. Opens /,
  },
  {
    name: "Posts · Accepted, window open, poster has not confirmed (I'm still on)",
    render: () => wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", helper_dayof_confirmed_at: null, poster_confirmed_at: null, helper_on_the_way_at: null, helper_arrived_at: null, date_needed: STARTS_SOON.date, start_time: STARTS_SOON.time }))} />),
    minControls: 2,
    primary: ["I'm still on"],
    primaryDisabled: false,
  },
  {
    name: "Posts · Accepted, poster confirmed, Helpr has not (Message <Helpr>; waiting on them)",
    render: () => wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", helper_dayof_confirmed_at: null, poster_confirmed_at: ago(0.5), helper_on_the_way_at: null, helper_arrived_at: null, date_needed: STARTS_SOON.date, start_time: STARTS_SOON.time }))} />),
    minControls: 2,
    primary: ["Message Hallie"],
    primaryDisabled: false,
    note: /Waiting on Hallie to confirm by .+ · Nudge/,
  },
  {
    // Owner, 2026-10-21: the date moved after accept; the poster's old confirm was cleared (20261021074803).
    name: "Posts · Accepted, date moved, poster owes the new time (Confirm; names the new slot)",
    render: () => {
      RESCHEDULED.v = true;
      return wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", helper_dayof_confirmed_at: null, poster_confirmed_at: null, helper_on_the_way_at: null, helper_arrived_at: null, date_needed: STARTS_SOON.date, start_time: STARTS_SOON.time }))} />);
    },
    minControls: 2,
    primary: ["Confirm"],
    primaryDisabled: false,
    note: /Confirm the new time, [A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M/,
  },
  {
    name: "Posts · Accepted, date moved, poster confirmed, Helpr owes (Message <Helpr>; waiting on the new slot)",
    render: () => {
      RESCHEDULED.v = true;
      return wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", helper_dayof_confirmed_at: null, poster_confirmed_at: ago(0.5), helper_on_the_way_at: null, helper_arrived_at: null, date_needed: STARTS_SOON.date, start_time: STARTS_SOON.time }))} />);
    },
    minControls: 2,
    primary: ["Message Hallie"],
    primaryDisabled: false,
    note: /Waiting for Hallie to confirm [A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M · Nudge/,
  },
  {
    name: "Posts · Accepted, both confirmed, not on the way yet (Message <Helpr>; says what's next)",
    render: () => wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", helper_dayof_confirmed_at: ago(0.5), poster_confirmed_at: ago(0.5), helper_on_the_way_at: null, helper_arrived_at: null, date_needed: STARTS_SOON.date, start_time: STARTS_SOON.time }))} />),
    minControls: 2,
    primary: ["Message Hallie"],
    primaryDisabled: false,
    note: /You're both confirmed\. Hallie taps On my way/,
  },
  {
    // Was a full-width button of its own in PostedJobCard, above the tracker.
    name: "Posts · Scheduled, Helpr says they arrived (Confirm they've arrived + Message · Cancel)",
    render: () => wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", poster_confirmed_arrival_at: null }))} />),
    minControls: 3,
    primary: ["Confirm they've arrived"],
  },
  {
    name: "Posts · In Progress, arrived (Confirm they've arrived + SOS · Message)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ poster_confirmed_arrival_at: null, poster_confirmed_working_at: null }))} />),
    minControls: 3,
    primary: ["Confirm they've arrived"],
  },
  {
    // Owner rule 2026-10-21 (lead ruling): no greyed "Confirm they're working" before the Helpr taps Start
    // working; "Message Hallie" holds the slot and the line says what happens next.
    name: "Posts · In Progress, arrival confirmed, Helpr not working yet (Message <Helpr>; waiting line)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ poster_confirmed_arrival_at: ago(5), poster_confirmed_working_at: null }))} />),
    minControls: 2,
    primary: ["Message Hallie"],
    primaryDisabled: false,
    note: /taps Start working when they begin/,
  },
  {
    // Q1400 (owner, 2026-10-07): no disabled arrival box before arrival.
    name: "Posts · In Progress, start passed and nobody arrived (no arrival box; Message <Helpr> primary · No-Show)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_working_at: null }))} />),
    minControls: 2,
    primary: ["Message Hallie"],
  },
  {
    /* WAS item 6c, "the box is drawn before the Helpr arrives, and says the
       truth": a disabled box with "on the way" under it. Owner decision Q1400
       (2026-10-07) hides it until the Helpr marks themselves arrived. */
    // Owner rule 2026-10-21 (lead ruling) supersedes Q1568's greyed box: "Message Hallie" + the waiting line.
    name: "Posts · In Progress, Helpr on the way, not arrived yet (Message <Helpr>; no greyed arrival box)",
    render: () =>
      wrap(
        <InProgressStep
          {...posterCtx(makeJob({ helper_arrived_at: null, helper_on_the_way_at: ago(1), poster_confirmed_working_at: null, date_needed: STARTS_SOON.date, start_time: STARTS_SOON.time }))}
        />,
      ),
    minControls: 1,
    primary: ["Message Hallie"],
    primaryDisabled: false,
    note: /on the way\. You'll confirm once they say they've arrived/,
  },
  {
    // ALREADY ACTIONED, STILL ON SCREEN (owner: "if it was clicked already it
    // should still show but with the box disabled"). Both vouches in, the job
    // still running: a done-toned box, never a greyed-out green.
    //
    // `date_needed: TODAY` is load-bearing since owner item 7: the job's
    // scheduled end is the end of its own day, and a job whose end has passed
    // with nobody marking it done is STALLED — its slot goes to the stalled
    // notice instead (the case directly below). A finished box is what a job
    // that is still legitimately running shows.
    name: "Posts · In Progress, both vouches in (disabled Working confirmed)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ date_needed: TODAY, poster_confirmed_arrival_at: ago(6), poster_confirmed_working_at: ago(5) }))} />),
    minControls: 3,
    primary: ["Working confirmed"],
    primaryDisabled: true,
    primaryDone: true,
  },
  {
    /* OWNER ITEM 7 — THE JOB NOBODY MARKED DONE (2026-09-19: "like for 24
       hours passed that needs to be deleted. that should have been a button
       like work done but since they never clicked it it should be disabled and
       say why").

       Both vouches given, the scheduled end long past, and NEITHER side has
       marked the job complete. `InProgressStep` gates its Approve chip on
       `helper_completed_at`, so this poster used to see no control and no
       explanation at all — and until `d738344c1` no sweep either, so the
       escrow just sat. The box is the sweep's OWN predicate (`completionStalled`,
       supabase/functions/_shared/stalledCompletion.ts), disabled, with the
       pinned reason under the row: the card cannot promise a window the cron
       does not enforce, and NOTHING here releases money. */
    name: "Posts · In Progress, nobody marked it done (disabled stalled box + the reason)",
    render: () =>
      wrap(
        <InProgressStep
          {...posterCtx(makeJob({
            date_needed: DAY_LONG_PAST,
            poster_confirmed_arrival_at: ago(26),
            poster_confirmed_working_at: ago(25),
            helper_completed_at: null,
            poster_completed_at: null,
          }))}
        />,
      ),
    // FOUR controls since the trim (owner, 2026-09-19, second pass: "trim to
    // one sentence. rest behind the tap"): the remainder of the notice moved
    // onto the row as a quiet "Why?" chip, because the box it explains is
    // disabled and cannot receive the tap itself.
    minControls: 4,
    primary: [STALLED_APPROVE_DISABLED_LABEL],
    primaryDisabled: true,
    // NOT the done tone: nothing here finished.
    primaryDone: false,
    // NO `note` field (owner, 2026-09-19, THIRD pass: "cut the note, let the
    // button speak"). The disabled primary label above already names who the
    // row is waiting on, so the note repeating it in more words was pure
    // duplication — it is gone from the card entirely now. (Was
    // /your payment stays in escrow/i when the note still rendered one
    // sentence above this same button; the sentence itself survives only in
    // the "Why?" dialog, per stalledNoticeDisclosure.test.tsx.)
  },
  {
    // ITEM 6b — a job in `revision_requested` derives to THIS step, but both
    // gates used to test `job.status === "in_progress"` literally, so a
    // revision job lost its confirmations outright. Same rule as an ordinary
    // in-progress job now: the working vouch is still owed and still offered.
    // Marked done: Approve and release is the primary; the optional working vouch stands down (owner, 2026-10-08).
    name: "Posts · Revision requested, Helpr marked done (Approve and release over the working vouch)",
    render: () =>
      wrap(
        <InProgressStep
          {...posterCtx(makeJob({
            status: "revision_requested",
            poster_confirmed_arrival_at: ago(6),
            poster_confirmed_working_at: null,
            helper_completed_at: ago(5),
            revision_requested_at: ago(3),
          }))}
          // The Helpr's tracker says they started (Q1571: the vouch waits for it).
          helperWorking
        />,
      ),
    minControls: 3,
    primary: ["Approve and release"],
  },
  {
    name: "Posts · In Progress, Helpr marked done (Message · Approve)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ poster_confirmed_arrival_at: ago(5), helper_completed_at: ago(1) }))} />),
    minControls: 2,
    primary: ["Approve and release"],
  },
  {
    name: "Posts · Completed (Tip · Review · Hire again)",
    render: () => wrap(<CompletedStep {...posterCtx(makeJob({ status: "completed", poster_completed_at: ago(1), helper_completed_at: ago(2), payment_status: "released" }))} />),
    minControls: 3,
    // Review and Tip are the primaries, right of More (owner, 2026-10-08).
    primary: ["Review", "Tip"],
  },
  {
    name: "Posts · Disputed (Resolve & Pay + Escalate · Timeline · Message · Contact admin)",
    render: () =>
      wrap(
        <DisputedStep
          {...posterCtx(makeJob({ status: "disputed", dispute_status: "open", disputed_by: POSTER, dispute_reason: "x", dispute_deadline: ahead(48) }))}
        />,
      ),
    minControls: 5,
    primary: ["Resolve & pay"],
  },
];

/** Content, not the card's moves: the step rail's per-step timestamp tooltips (the old rail's "Job progress"
 *  group, and the 8-step tracker's done/current steps since 2026-10-23, [data-job-steps]), an open inline form,
 *  and dialogs. */
const isContent = (el: Element) =>
  !!el.closest('[role="group"][aria-label="Job progress"]') ||
  !!el.closest("[data-job-steps]") ||
  !!el.closest("[data-job-step-form]") ||
  !!el.closest('[role="dialog"]');

/** The buttons and links the card offers as moves. */
function actionControls(card: Element): HTMLElement[] {
  return [...card.querySelectorAll<HTMLElement>("button, a[href]")].filter((el) => !isContent(el));
}

describe("VN-21 — a step card's buttons are ONE row", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const { container } = c.render();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      const card = container.querySelector("[data-job-step]");
      expect(card, "no JobStepCard rendered — this state bypassed the shared shell").not.toBeNull();

      const controls = actionControls(card!);
      const labels = controls.map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim());
      // Every chip lives under More now (owner, 2026-10-08): the row is More +
      // the primary, so the card's moves are the row's visible controls plus
      // the actions folded into More (its trigger states how many).
      const moreTrigger = card!.querySelector<HTMLElement>("[data-job-step-overflow]");
      // What More holds, read by opening it.
      let moreLabels: string[] = [];
      if (moreTrigger) {
        await act(async () => { fireEvent.click(moreTrigger); });
        const panel = document.querySelector("[data-job-step-overflow-panel]");
        moreLabels = [...(panel?.querySelectorAll<HTMLElement>("button, a[href]") ?? [])].map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim());
        await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); });
      }
      // Counted the way the cases were written (Report a Problem / Dispute / SOS
      // already shared one More slot): the case counts stay the same truth.
      const alwaysMore = moreLabels.filter((l) => /^(Report a Problem|Dispute|SOS|Share location|Safety)/i.test(l)).length;
      const offered = controls.length - (moreTrigger ? 1 : 0) + (moreLabels.length - alwaysMore) + (alwaysMore > 0 ? 1 : 0);
      expect(
        offered,
        `expected at least ${c.minControls} controls, got [${labels.join(" | ")}] — the fixture no longer reaches this state`,
      ).toBeGreaterThanOrEqual(c.minControls);
      if (c.maxControls !== undefined) {
        expect(
          offered,
          `expected at most ${c.maxControls} controls, got [${labels.join(" | ")}] — a control this state must not offer is back`,
        ).toBeLessThanOrEqual(c.maxControls);
      }

      const rows = card!.querySelectorAll("[data-job-step-row]");
      expect(rows.length, `${rows.length} action rows on one card — [${labels.join(" | ")}]`).toBe(1);
      const row = rows[0] as HTMLElement;

      // The Nudge link lives on the row's note line by design (owner, 2026-10-08: "a one-line link on the
      // row's note line"); it is the status line's own action, not a second row.
      const outside = controls.filter((b) => !row.contains(b) && !b.closest("[data-nudge-confirm]"));
      expect(
        outside.map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim()),
        "these controls render on their own row, outside the step's single action row",
      ).toEqual([]);

      // ONE ROW = More (left) + the primary (right), nothing else (owner,
      // 2026-10-08: "move everything besides the primary button into the more
      // tab ... more button will be to the left of the primary button").
      const kids = [...row.children].filter((k) => !(k as HTMLElement).hasAttribute("data-job-step-primary"));
      // ONE extra action is not a menu (owner 2026-11-01: "if no show is the only option then just remove the more
      // button bc there isn't really more"): a lone action sits there itself; More only ever holds two or more.
      const besides = kids.map((k) => (k.getAttribute("aria-label") || k.textContent || "").trim());
      expect(besides.length, `only More, or the one extra action, may sit beside the primary: [${besides.join(" | ")}]`).toBeLessThanOrEqual(1);
      if (moreTrigger) {
        const held = Number(/More — (\d+) more/.exec(moreTrigger.getAttribute("aria-label") ?? "")?.[1] ?? NaN);
        expect(held, "a More menu holding ONE action").toBeGreaterThanOrEqual(2);
        expect(moreTrigger.nextElementSibling?.hasAttribute("data-job-step-primary"), "More sits directly left of the primary").toBe(true);
      }
      // The primary TRAILS the row on the right (owner, 2026-09-15, V2/V3:
      // "primary buttons should be RIGHT"), and it is the control this state
      // is about. It is the LAST child; the chips lead.
      const primarySlot = row.lastElementChild as HTMLElement;
      expect(primarySlot.hasAttribute("data-job-step-primary"), "the row does not end with its primary slot").toBe(true);
      const primaryLabels = [...primarySlot.children].map((b) => (b.textContent || "").trim());
      expect(primaryLabels, "the row's primary").toEqual(c.primary);
      // The row may never wrap onto a second line.
      const cls = row.className.split(/\s+/);
      expect(cls, "the action row is not a flex row").toContain("flex");
      expect(cls, "the action row must not wrap").toContain("flex-nowrap");
      expect(cls.some((k) => k === "flex-wrap" || k.startsWith("grid")), "the action row can wrap").toBe(false);

      // At most ONE primary, and when there is one it is the row's primary slot.
      // ONE EXCEPTION (owner, 2026-10-08: "tip and review is also a primary
      // button"): the Done card's Review and Tip, both right of More.
      const glossy = [...card!.querySelectorAll<HTMLElement>("button.btn-grad-primary")].filter((b) => !isContent(b));
      const maxPrimaries = c.name.startsWith("Posts · Completed") ? 2 : 1;
      expect(glossy.length, `primaries: [${glossy.map((b) => b.textContent?.trim()).join(" | ")}]`).toBeLessThanOrEqual(maxPrimaries);
      for (const g of glossy) {
        expect(g.closest("[data-job-step-primary]"), `${g.textContent?.trim()} is glossy but not the row's primary`).not.toBeNull();
      }
      // …and the primary IS the dark green one (owner: "primary action in the
      // dark green (btn primary)") — not a tint or an outline.
      //
      // LAST, not first (owner, 2026-09-16: the green primary is the
      // RIGHT-most control). The slot is a flex row, so its last child is its
      // right-hand one; on every state but the legacy-arrival retry the slot
      // holds a single control and first and last are the same element.
      if (c.primary.length > 0) {
        const rightMost = primarySlot.lastElementChild as HTMLElement;
        // A FINISHED box is the one exception, and it declares itself
        // (`data-job-step-done`, JobActionRow) rather than just quietly
        // lacking the gloss — which is what a real regression looks like.
        if (c.primaryDone) {
          expect(rightMost.hasAttribute("data-job-step-done"), `"${primaryLabels[0]}" is not marked as a finished box`).toBe(true);
          expect(
            rightMost.classList.contains("btn-grad-primary"),
            `the finished box "${primaryLabels[0]}" wears the glossy primary — a done state must not look like the live action`,
          ).toBe(false);
        } else {
          expect(
            rightMost.classList.contains("btn-grad-primary"),
            `the row's right-most primary "${primaryLabels[primaryLabels.length - 1]}" does not wear btn-grad-primary`,
          ).toBe(true);
        }
        // Disabled means disabled — and a disabled control the card cannot
        // explain is the anti-pattern (JobTracking's blocked CTA always has
        // its one line; PayoutPrimary's disabled twin is why we don't).
        if (c.primaryDisabled !== undefined) {
          expect(
            (rightMost as HTMLButtonElement).disabled,
            `"${primaryLabels[primaryLabels.length - 1]}" should be ${c.primaryDisabled ? "disabled" : "enabled"}`,
          ).toBe(c.primaryDisabled);
        }
      }
      if (c.note) {
        const note = card!.querySelector("[data-job-step-note]");
        expect(note?.textContent ?? "", `the disabled primary has no reason under it — [${labels.join(" | ")}]`).toMatch(c.note);
      }
    });
  }
});

/**
 * V2/V3 — THE GREEN PRIMARY IS THE RIGHT-MOST CONTROL, and a destructive one
 * never is (owner, 2026-09-16, reaffirmed 2026-09-19).
 *
 * The row itself is held to this by the primary-slot assertions above. These
 * two are the places the row's guard CANNOT see, which is exactly why they
 * still had it backwards:
 *
 *  - the helper's dispute-response FORM, which `data-job-step-form` marks as
 *    content so the one-row guard skips it — it had the glossy Submit FIRST
 *    with a ghost Cancel to its right;
 *  - the poster's OPEN step, which has no primary at all, and put the
 *    destructive Cancel in the right-most slot ("furthest from the thumb", a
 *    rationale the owner has now reversed).
 */
describe("V2/V3 — the green primary trails, the destructive one never does", () => {
  it("puts Submit right of Cancel in the dispute-response form", async () => {
    const { container } = disputed(
      makeJob({ status: "disputed", dispute_status: "open", disputed_by: POSTER, dispute_reason: "x" }),
      "job-1",
    )();
    await act(async () => { await Promise.resolve(); });

    const form = container.querySelector("[data-job-step-form]");
    expect(form, "the response form did not open — the fixture no longer reaches this state").not.toBeNull();
    const buttons = [...form!.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(["Cancel", "Submit"]);

    const glossy = buttons.filter((b) => b.classList.contains("btn-grad-primary"));
    expect(glossy.length, "the form should have exactly one glossy primary").toBe(1);
    expect(
      glossy[0],
      "the glossy primary is not the right-most control in its row",
    ).toBe(buttons[buttons.length - 1]);
  });

  it("does not leave the destructive chip in the poster's right-most slot", async () => {
    const { container } = wrap(<OpenStep {...posterCtx(makeJob({ status: "open", helper_id: null, date_needed: "2099-01-01" }))} />);
    await act(async () => { await Promise.resolve(); });

    // Since 2026-10-08 Cancel lives under More (with every other chip), in the
    // ways-out group near the bottom, never first.
    const trigger = container.querySelector<HTMLElement>("[data-job-step-overflow]")!;
    await act(async () => { fireEvent.click(trigger); });
    const labels = [...document.querySelectorAll<HTMLElement>("[data-job-step-overflow-panel] button")].map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim());
    const cancel = labels.findIndex((l) => /^Cancel/.test(l));
    expect(cancel, `Cancel is not under More — [${labels.join(" | ")}]`).toBeGreaterThan(0);
    expect(labels.slice(cancel + 1).every((l) => /^(SOS|Share location)/i.test(l)), `only SOS may follow Cancel — [${labels.join(" | ")}]`).toBe(true);
  });
});

describe("VN-21 — the TIGHT rung instead of a second row (and never icon-only)", () => {
  it("keeps the roomy 2:1 shares while every chip has room for its label", () => {
    // 1440: the row is ~1000px.
    expect(shouldTightenJobStepRow({ width: 1000, chips: 3, hasPrimary: true })).toBe(false);
    expect(shouldTightenJobStepRow({ width: 1000, chips: 4, hasPrimary: true })).toBe(false);
    // 311px — near the real 375 row (262px, measured on prod 2026-09-19).
    // Primary + 2 chips still fits labels…
    expect(shouldTightenJobStepRow({ width: 311, chips: 2, hasPrimary: true })).toBe(false);
    // …and 3–4 chips with no primary do too (Open: Share · Boost · Edit · Cancel).
    expect(shouldTightenJobStepRow({ width: 311, chips: 4, hasPrimary: false })).toBe(false);
  });

  it("tightens when 3–4 buttons would squeeze a label at 375 and 320", () => {
    // Widths are the function's arguments; the app's rows measure 262 at 375
    // and 212 at 320. Primary + 3 chips (Confirmed, On the way).
    expect(shouldTightenJobStepRow({ width: 311, chips: 3, hasPrimary: true })).toBe(true);
    // 375: primary + 4 chips (poster Disputed).
    expect(shouldTightenJobStepRow({ width: 311, chips: 4, hasPrimary: true })).toBe(true);
    // A narrower row still, primary + 2 chips.
    expect(shouldTightenJobStepRow({ width: 256, chips: 2, hasPrimary: true })).toBe(true);
    // …and the REAL 320 row is narrower than either of those.
    expect(shouldTightenJobStepRow({ width: 212, chips: 3, hasPrimary: true })).toBe(true);
  });

  it("measures WORDS: short labels stay roomy in a row a long word would not fit", () => {
    // Open at 375 (Share · Boost · Edit · Cancel, ~62px each): the longest word
    // needs ~48px, so the shares hold — the fixed 68px floor would not have.
    expect(shouldTightenJobStepRow({ width: 267, chips: 4, hasPrimary: false, chipNeedPx: 48 })).toBe(false);
    expect(shouldTightenJobStepRow({ width: 267, chips: 4, hasPrimary: false, chipNeedPx: 72 })).toBe(true);
    // A primary that would need three lines at two shares tightens the row.
    expect(shouldTightenJobStepRow({ width: 267, chips: 2, hasPrimary: true, chipNeedPx: 57, primaryNeedPx: 140 })).toBe(true);
  });

  it("leaves the primary real room once the row is tight — there is no third rung", () => {
    // This replaced `shouldTightenJobStepPrimary` (owner, 2026-09-19): the old
    // rung answered "is the primary short?" by stepping it down to 12px and
    // stripping its icon, which is how the row ended up with three type sizes
    // and two shapes.
    //
    // THE WIDTHS BELOW ARE THE FUNCTION'S ARGUMENTS, NOT THE APP'S ROW. 311 and
    // 256 were written here as "375" and "320" and were never measured; the row
    // is 262px at 375 and 212px at 320 (measured on prod, 2026-09-19).
    //
    // `chipPx` is now an ARGUMENT rather than a 44px constant, because a chip
    // is as wide as its own label needs (owner, 2026-09-19, second phone
    // report: a chip that cannot show its label leaves the row instead of
    // going anonymous). At the 44px tap floor the numbers are the old ones:
    expect(primaryRoomAfterTightening({ width: 311, chipSlots: 3, chipPx: 44 })).toBe(161);
    expect(primaryRoomAfterTightening({ width: 256, chipSlots: 4, chipPx: 44 })).toBe(56);
    expect(primaryRoomAfterTightening({ width: 256, chipSlots: 4, chipPx: 44 })).toBeGreaterThan(40);
    // …and the REAL 320 row, which is the number that matters: four 44px chip
    // slots leave 12px — which is what shipped. `allocateJobStepRow` is what
    // stops four slots being drawn there at all.
    expect(primaryRoomAfterTightening({ width: 212, chipSlots: 4, chipPx: 44 })).toBe(12);
    expect(primaryRoomAfterTightening({ width: 212, chipSlots: 3, chipPx: 44 })).toBe(62);
    // At the LABELLED width the same row holds fewer slots and the primary is
    // better off for it: two 58px chips (the "Evidence" word) leave 84px.
    expect(primaryRoomAfterTightening({ width: 212, chipSlots: 2, chipPx: 58 })).toBe(84);
    expect(primaryRoomAfterTightening({ width: 0, chipSlots: 4, chipPx: 44 })).toBe(0);
  });

  it("never tightens an unmeasured row or a lone button", () => {
    expect(shouldTightenJobStepRow({ width: 0, chips: 4, hasPrimary: true })).toBe(false);
    expect(shouldTightenJobStepRow({ width: 200, chips: 1, hasPrimary: false })).toBe(false);
    expect(shouldTightenJobStepRow({ width: 200, chips: 0, hasPrimary: true })).toBe(false);
  });

  it("the shell measures its row, and every control left in it KEEPS ITS LABEL", async () => {
    // jsdom lays nothing out: give the row the 375-ish width and every measured
    // label word (the shell's off-screen probe span) a 60px width — about
    // "Directions" at 11px, which needs 72px with the chip's padding.
    const widthSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const w = this.hasAttribute("data-job-step-row") ? 311 : this.style.left === "-9999px" ? 60 : 0;
      return { width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    try {
      const { container } = active(makeJob({ helper_arrived_at: null, poster_confirmed_working_at: null }), "on_the_way")();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });
      const row = container.querySelector<HTMLElement>("[data-job-step-row]")!;
      expect(row.getAttribute("data-has-primary")).toBe("true");
      // More + the primary only (owner, 2026-10-08): nothing left to tighten.
      expect([...row.children].filter((ch) => !ch.hasAttribute("data-job-step-primary")).length).toBe(1);
      // …and the row is marked tight WITHOUT a `data-compact` anywhere: that
      // attribute is what `index.css` hung the sr-only label rule off, and the
      // rule and the attribute went together.
      expect(row.hasAttribute("data-compact"), "the icon-only rung is back").toBe(false);
      // Every chip STILL IN THE ROW carries visible text, not just a name.
      const chips = [...row.children].filter((ch) => !ch.hasAttribute("data-job-step-primary"));
      expect(chips.length).toBeGreaterThanOrEqual(1);
      for (const chip of chips) {
        const span = [...chip.querySelectorAll("span")].find(
          (sp) => (sp.textContent || "").trim() && !sp.classList.contains("sr-only"),
        );
        expect(
          (span?.textContent || "").trim(),
          `a chip in the row has no VISIBLE label — [${(chip.getAttribute("aria-label") || chip.textContent || "").trim()}]`,
        ).not.toBe("");
      }
      // …and the chips that did not fit are reachable, labelled, behind `More`.
      const more = row.querySelector("[data-job-step-overflow]");
      if (more) {
        expect((more.textContent || "").trim()).toContain("More");
      }
    } finally {
      widthSpy.mockRestore();
    }
  });
});

describe("VN-21 — a nested CTA replaces the step's own primary", () => {
  it("renders the step's primary only while nothing has claimed the slot", async () => {
    const { rerender, container } = render(
      <JobStepCard side="helper" step="t" primary={<button type="button">Fallback</button>} actions={[<button key="m" type="button">Message</button>]} />,
    );
    await act(async () => { await Promise.resolve(); });
    const slot = () => container.querySelector("[data-job-step-primary]")!;
    expect([...slot().children].map((b) => b.textContent)).toEqual(["Fallback"]);

    rerender(
      <JobStepCard
        side="helper"
        step="t"
        header={<JobStepRowSlot slot="primary"><button type="button">Tracker CTA</button></JobStepRowSlot>}
        primary={<button type="button">Fallback</button>}
        actions={[<button key="m" type="button">Message</button>]}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    expect([...slot().children].map((b) => b.textContent), "two primaries in one row").toEqual(["Tracker CTA"]);
  });

  it("renders a slot in place when there is no step card around it", () => {
    const { container } = render(<JobStepRowSlot slot="primary"><button type="button">Standalone</button></JobStepRowSlot>);
    expect(container.textContent).toBe("Standalone");
  });
});

// Shown able to fail: a nested CTA (the tracker`s next-step button) claiming the
// row`s primary slot must stand the step`s OWN primary down. Drop the claim
// check and the working card draws two glossy CTAs in one row.
// @mutate src/components/job-card/JobStepCard.tsx | const ownPrimary = claims === 0 && hasRenderable(primary) ? primary : null; | const ownPrimary = hasRenderable(primary) ? primary : null;

// Shown able to fail (Q1561, owner 2026-10-08: "move everything besides the
// primary button into the more tab, for poster and Helpr"): put Message, Cancel,
// Edit... back on the row beside the primary and every state above goes red.
// @mutate src/components/job-card/JobStepCard.tsx | const isMoreOnly = (_c: ReactNode) => true; | const isMoreOnly = (c: ReactNode) => isValidElement(c) && MORE_ONLY_CHIP_KEYS.includes(String(c.key));

// Owner 2026-11-01 (job page): the card's actions reach the page's row MINUS Message, which the page draws itself.
// A card holding Message and No-Show hands the page exactly one action, No-Show, for its second button.
// @mutate src/components/job-card/JobStepCard.tsx | ...moreChips.filter((c) => !(isValidElement(c) && c.key === "message"))] | ...moreChips]
describe("on the job page, the card hands over its actions minus Message", () => {
  it("Message and No-Show: one action reaches the page's second slot, and it is No-Show", async () => {
    const { JobStepMenuContext } = await import("./jobStepMenu");
    const second = document.createElement("div");
    document.body.appendChild(second);
    const counts: number[] = [];
    try {
      render(
        <JobStepMenuContext.Provider value={{ secondHost: second, listHost: null, leadHost: null, setCount: (n) => counts.push(n), setLeadCount: () => {} }}>
          <JobStepCard side="poster" step="t"
            actions={[<button key="message" type="button">Message</button>, <button key="noshow" type="button">No-Show</button>]} />
        </JobStepMenuContext.Provider>,
      );
      await act(async () => { await Promise.resolve(); });
      expect(counts.length).toBeGreaterThan(0);
      expect(counts[counts.length - 1]).toBe(1);
      expect(second.textContent).toBe("No-Show");
    } finally {
      second.remove();
    }
  });

  // L29 (happy-path smoke 11-01): a Message primary standing in for the Message chip was handed to the page as the
  // card's lead, so the page drew its own Message AND the card's: "Message | Message".
  // @mutate src/components/job-card/JobStepCard.tsx | const menuPrimaries = menu && primaryChipKey !== "message" ? primaryButtons(ownPrimary) : []; | const menuPrimaries = menu ? primaryButtons(ownPrimary) : [];
  it("a Message primary (primaryChipKey message) is not offered as the card's lead: the page has its own Message", async () => {
    const { JobStepMenuContext } = await import("./jobStepMenu");
    const { JobStepPrimaryButton } = await import("./JobActionRow");
    const { MessageSquare } = await import("lucide-react");
    const leads: number[] = [];
    render(
      <JobStepMenuContext.Provider value={{ secondHost: null, listHost: null, leadHost: null, setCount: () => {}, setLeadCount: (n) => leads.push(n) }}>
        <JobStepCard side="poster" step="t" primaryChipKey="message"
          primary={<JobStepPrimaryButton icon={MessageSquare} label="Message Marcus" onClick={() => {}} />}
          actions={[<button key="message" type="button">Message</button>, <button key="noshow" type="button">No-Show</button>]} />
      </JobStepMenuContext.Provider>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(leads.length).toBeGreaterThan(0);
    expect(leads[leads.length - 1]).toBe(0);
  });
});
