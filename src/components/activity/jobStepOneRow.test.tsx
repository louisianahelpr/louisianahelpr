import { describe, it, expect, vi, beforeAll } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { AppliedApp, Job } from "./activityConstants";
import type { PosterStepCtx } from "./postedJobCard/steps/posterStepContract";

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

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
// Uploaders and proof galleries are content (the `ask`), not the row's moves.
vi.mock("@/components/PhotoProof", () => ({
  PhotoProofGroup: () => <div data-testid="photo-proof" />,
  PhotoProofStep: ({ title }: { title: string }) => <div data-testid="photo-proof-step">{title}</div>,
  // The gallery the step cards' `Photos` chip opens (owner item 10). Closed,
  // portalled and contributing no control — stubbed to nothing so the row's
  // own count is unaffected either way.
  PhotoProofDialog: () => null,
  PhotoProofRequirementNote: () => null,
  // THE CAPTURE CONTROL, which now lives IN the row (owner, 2026-09-19:
  // "before and after buttons should also be on the same lines as the other
  // buttons"). NOT stubbed to null: it is one of the row's controls and the
  // per-case floors below count it.
  PhotoProofCaptureChip: ({ label }: { label: string }) => <button type="button">{label}</button>,
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

import { ActiveJobSection } from "./appliedJobCard/ActiveJobSection";
import { ConfirmedSection } from "./appliedJobCard/ConfirmedSection";
import { DisputedSection } from "./appliedJobCard/DisputedSection";
import { InProgressStep } from "./postedJobCard/steps/InProgressStep";
import { ScheduledStep } from "./postedJobCard/steps/ScheduledStep";
import { OpenStep } from "./postedJobCard/steps/OpenStep";
import { CompletedStep } from "./postedJobCard/steps/CompletedStep";
import { DisputedStep } from "./postedJobCard/steps/DisputedStep";
import { JobStepCard } from "./JobStepCard";
import { JobStepRowSlot, shouldCompactJobStepRow, primaryRoomAfterCompaction } from "./jobStepRow";
// The sweep's own copy, never a retyped copy of it (owner item 7).
import { STALLED_APPROVE_DISABLED_LABEL } from "../../../supabase/functions/_shared/stalledCompletion";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const HELPER = "helper-1";
const POSTER = "poster-1";
const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const YESTERDAY = new Date(NOW - 24 * 3_600_000).toISOString().slice(0, 10);
const TODAY = new Date(NOW).toISOString().slice(0, 10);

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
 *  rather than the legacy "Try My Location Again" retry. */
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
    unfunded: false,
    completingJobId: null,
    confirmingArrivalJobId: null,
    confirmingWorkingJobId: null,
    instantReleaseOn: false,
    navigate: vi.fn(),
    onBoost: vi.fn(),
    onEdit: vi.fn(),
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
  // ── /my-jobs, Helpr ──
  {
    /* THE START HAS NOT PASSED — and that is the whole state this case names.
       It was written `date_needed: TODAY, start_time: "00:00"`, which is a job
       whose start is already hours behind us; `ae6c80903` then (correctly)
       hid the Cancel Job chip in exactly that window, because
       `helper_cancel_booking` REFUSES it there (`job_already_started`) and an
       offered control that the server refuses is a dead-end tap. The fixture
       had simply stopped reaching the state its own name describes, and the
       floor caught it: three controls, not four. The product is right; the
       clock in the fixture was wrong. Its companion below pins the other side
       of that same gate. */
    name: "Jobs · Confirmed (tracker CTA + Directions · Message · Cancel Job)",
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
    primary: ["I'm On My Way"],
    primaryDisabled: false,
  },
  {
    /* THE SAME CARD PAST ITS START, so the pair states the rule rather than
       one side of it: `helper_cancel_booking` refuses a cancel once the
       scheduled start has passed (ae6c80903), so the chip is gone and the row
       is legitimately three controls. Without this case, a future change that
       hid Cancel EVERYWHERE would still pass the case above by accident of the
       clock. */
    name: "Jobs · Confirmed, start already passed (no Cancel Job — the RPC would refuse it)",
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
    minControls: 3,
    maxControls: 3,
    primary: ["I'm On My Way"],
  },
  {
    name: "Jobs · Confirmed, day-of confirmation still owed (I'm Still On)",
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
    primary: ["I'm Still On"],
  },
  {
    name: "Jobs · On the Way (I've Arrived + Directions · Message · Report a Problem)",
    render: active(makeJob({ helper_arrived_at: null, poster_confirmed_working_at: null }), "on_the_way"),
    minControls: 4,
    primary: ["I've Arrived"],
  },
  {
    // The fixture carries both proof photos, so the capture chip is absent —
    // the row is legitimately three. Its companion above pins the other side.
    name: "Jobs · Arrived (Start Working + Message · Report a Problem)",
    render: active(makeJob({ ...VERIFIED, poster_confirmed_working_at: null }), "arrived"),
    minControls: 3,
    maxControls: 3,
    primary: ["Start Working"],
  },
  {
    // The GREEN PRIMARY IS LAST (owner, 2026-09-16: the primary belongs on the
    // right). The slot is a flex row, so source order is left-to-right: the
    // outline retry first, the glossy "Start Working" right-most. Swapped from
    // ["Start Working", "Try My Location Again"], which put the outline to the
    // RIGHT of the primary on the one state that shows both.
    name: "Jobs · Arrived, legacy unverified arrival (Try My Location Again + Start Working share the slot)",
    render: active(makeJob({ poster_confirmed_working_at: null }), "arrived"),
    minControls: 4,
    primary: ["Try My Location Again", "Start Working"],
  },
  {
    // The pair singlePrimaryCta.test.tsx pinned at 2: the tracker's "Mark Job
    // Complete" above PayoutPrimary's identical one. The tracker's IS the
    // primary; PayoutPrimary stands down.
    name: "Jobs · Working (Mark Job Complete + Message · Report a Problem)",
    render: active(makeJob({ ...VERIFIED }), "working"),
    minControls: 3,
    primary: ["Mark Job Complete"],
  },
  {
    /* THE CAPTURE IS IN THE ROW NOW (owner, 2026-09-19: "before and after
       buttons should also be on the same lines as the other buttons"). It was
       a titled panel with a full-width "Add Photo" button in the `ask` slot
       ABOVE the row — the block in the owner's screenshot. Four controls, not
       three: After Photo · Message · Report a Problem + the disabled primary. */
    name: "Jobs · Working, after photo still owed (After Photo chip IN the row, disabled Mark Job Complete)",
    render: active(makeJob({ ...VERIFIED, proof_after_urls: [] }), "working"),
    minControls: 4,
    maxControls: 4,
    primary: ["Mark Job Complete"],
  },
  {
    name: "Jobs · Submitted (Message · Report a Problem, no primary)",
    render: active(makeJob({ ...VERIFIED, helper_completed_at: ago(2) }), "done"),
    minControls: 2,
    primary: [],
  },
  {
    name: "Jobs · Revision (I'll Fix It + Message)",
    render: active(
      makeJob({
        status: "revision_requested", helper_completed_at: ago(5), revision_requested_at: ago(3),
        revision_deadline: ahead(60), revision_note: "The back gate area was missed.",
      }),
      "working",
    ),
    minControls: 3,
    primary: ["I'll Fix It"],
  },
  {
    name: "Jobs · Disputed, filed by the Helpr (Withdraw + Timeline · Message · Contact Admin)",
    render: disputed(makeJob({ status: "disputed", dispute_status: "open", disputed_by: HELPER, dispute_reason: "x" })),
    minControls: 4,
    primary: ["Withdraw Dispute"],
  },
  {
    name: "Jobs · Disputed, filed by the poster (Respond + Timeline · Message · Contact Admin)",
    render: disputed(makeJob({ status: "disputed", dispute_status: "open", disputed_by: POSTER, dispute_reason: "x" })),
    minControls: 4,
    primary: ["Respond to Dispute"],
  },
  // ── /my-posts, poster ──
  {
    name: "Posts · Open (Share · Boost · Edit · Cancel)",
    render: () => wrap(<OpenStep {...posterCtx(makeJob({ status: "open", helper_id: null }))} />),
    minControls: 4,
    primary: [],
  },
  {
    // THE LADDER'S FIRST RUNG (owner, 2026-09-19). This state used to render
    // NO primary at all — the confirm box only appeared at the one instant it
    // was tappable — which is why the owner reported "no button to confirm
    // they arrived". It is now a disabled box with an honest reason.
    name: "Posts · Scheduled, nothing to confirm yet (disabled Confirm Arrival + Message · Cancel)",
    render: () => wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", helper_on_the_way_at: null, helper_arrived_at: null }))} />),
    minControls: 3,
    primary: ["Confirm Arrival"],
    primaryDisabled: true,
    note: /once your Helpr is at the job/,
  },
  {
    // Was a full-width button of its own in PostedJobCard, above the tracker.
    name: "Posts · Scheduled, Helpr says they arrived (Confirm Arrival + Message · Cancel)",
    render: () => wrap(<ScheduledStep {...posterCtx(makeJob({ status: "accepted", poster_confirmed_arrival_at: null }))} />),
    minControls: 3,
    primary: ["Confirm Arrival"],
  },
  {
    name: "Posts · In Progress, arrived (Confirm They Arrived + SOS · Message)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ poster_confirmed_arrival_at: null, poster_confirmed_working_at: null }))} />),
    minControls: 3,
    primary: ["Confirm They Arrived"],
  },
  {
    name: "Posts · In Progress, arrival confirmed (Confirm They're Working + SOS · Message)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ poster_confirmed_arrival_at: ago(5), poster_confirmed_working_at: null }))} />),
    minControls: 3,
    primary: ["Confirm They're Working"],
  },
  {
    name: "Posts · In Progress, start passed and nobody arrived (disabled Confirm They Arrived + No-Show · Message)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ helper_on_the_way_at: null, helper_arrived_at: null, poster_confirmed_working_at: null }))} />),
    minControls: 3,
    primary: ["Confirm They Arrived"],
    primaryDisabled: true,
    note: /once your Helpr is at the job/,
  },
  {
    /* THE BOX IS DRAWN BEFORE THE HELPR ARRIVES (owner item 6c), and it says
       the truth about why it is not tappable yet.

       WAS: "Helpr on the way but no location fix … the honest reason", pinned
       on `/location check/i`. Between 20260915044137 and 20260919155016 a far
       or fix-less arrival was REFUSED and wrote nothing, so `helper_arrived_at`
       stayed null while the Helpr's blocked CTA told them to go ask for this
       very tap — a deadlock, and the box existed to name it.

       The owner ended that on 2026-09-19: `mark_helper_arrival` records every
       check-in, so this row can only mean the ordinary thing — they are on
       their way and have not tapped "I've Arrived" yet. "Waiting on your
       Helpr's location check" is now a failure the app would be inventing, so
       the copy and this pin moved with the rule. */
    name: "Posts · In Progress, Helpr on the way, not arrived yet (disabled + the honest reason)",
    render: () =>
      wrap(
        <InProgressStep
          {...posterCtx(makeJob({ helper_arrived_at: null, helper_on_the_way_at: ago(1), poster_confirmed_working_at: null }))}
        />,
      ),
    minControls: 2,
    primary: ["Confirm They Arrived"],
    primaryDisabled: true,
    note: /on the way/i,
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
    name: "Posts · In Progress, both vouches in (disabled Working Confirmed)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ date_needed: TODAY, poster_confirmed_arrival_at: ago(6), poster_confirmed_working_at: ago(5) }))} />),
    minControls: 3,
    primary: ["Working Confirmed"],
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
            date_needed: YESTERDAY,
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
    name: "Posts · Revision requested, working vouch still owed (Confirm They're Working)",
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
        />,
      ),
    minControls: 3,
    primary: ["Confirm They're Working"],
  },
  {
    name: "Posts · In Progress, Helpr marked done (Message · Approve)",
    render: () => wrap(<InProgressStep {...posterCtx(makeJob({ poster_confirmed_arrival_at: ago(5), helper_completed_at: ago(1) }))} />),
    minControls: 2,
    primary: [],
  },
  {
    name: "Posts · Completed (Tip · Review · Hire Again)",
    render: () => wrap(<CompletedStep {...posterCtx(makeJob({ status: "completed", poster_completed_at: ago(1), helper_completed_at: ago(2), payment_status: "released" }))} />),
    minControls: 3,
    primary: [],
  },
  {
    name: "Posts · Disputed (Resolve & Pay + Escalate · Timeline · Message · Contact Admin)",
    render: () =>
      wrap(
        <DisputedStep
          {...posterCtx(makeJob({ status: "disputed", dispute_status: "open", disputed_by: POSTER, dispute_reason: "x", dispute_deadline: ahead(48) }))}
        />,
      ),
    minControls: 5,
    primary: ["Resolve & Pay"],
  },
];

/** Content, not the card's moves: the step rail's per-step timestamp tooltips,
 *  an open inline form, and dialogs. */
const isContent = (el: Element) =>
  !!el.closest('[role="group"][aria-label="Job progress"]') ||
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
      expect(
        controls.length,
        `expected at least ${c.minControls} controls, got [${labels.join(" | ")}] — the fixture no longer reaches this state`,
      ).toBeGreaterThanOrEqual(c.minControls);
      if (c.maxControls !== undefined) {
        expect(
          controls.length,
          `expected at most ${c.maxControls} controls, got [${labels.join(" | ")}] — a control this state must not offer is back`,
        ).toBeLessThanOrEqual(c.maxControls);
      }

      const rows = card!.querySelectorAll("[data-job-step-row]");
      expect(rows.length, `${rows.length} action rows on one card — [${labels.join(" | ")}]`).toBe(1);
      const row = rows[0] as HTMLElement;

      const outside = controls.filter((b) => !row.contains(b));
      expect(
        outside.map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim()),
        "these controls render on their own row, outside the step's single action row",
      ).toEqual([]);

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
      const glossy = [...card!.querySelectorAll<HTMLElement>("button.btn-grad-primary")].filter((b) => !isContent(b));
      expect(glossy.length, `primaries: [${glossy.map((b) => b.textContent?.trim()).join(" | ")}]`).toBeLessThanOrEqual(1);
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
    const { container } = wrap(<OpenStep {...posterCtx(makeJob({ status: "open", helper_id: null }))} />);
    await act(async () => { await Promise.resolve(); });

    const row = container.querySelector("[data-job-step-row]")!;
    const chips = [...row.children].filter((c) => !c.hasAttribute("data-job-step-primary"));
    const labels = chips.map((c) => (c.getAttribute("aria-label") || c.textContent || "").trim());
    expect(labels[0], `Cancel should lead the row — got [${labels.join(" | ")}]`).toMatch(/^Cancel/);
    expect(
      labels[labels.length - 1],
      `a destructive control is the right-most in the row — [${labels.join(" | ")}]`,
    ).not.toMatch(/^Cancel/);
  });
});

describe("VN-21 — icon-only chips instead of a second row", () => {
  it("keeps labels while every chip has room for one", () => {
    // 1440: the row is ~1000px.
    expect(shouldCompactJobStepRow({ width: 1000, chips: 3, hasPrimary: true })).toBe(false);
    expect(shouldCompactJobStepRow({ width: 1000, chips: 4, hasPrimary: true })).toBe(false);
    // 311px — near the real 375 row (262px, measured on prod 2026-09-19).
    // Primary + 2 chips still fits labels…
    expect(shouldCompactJobStepRow({ width: 311, chips: 2, hasPrimary: true })).toBe(false);
    // …and 3–4 chips with no primary do too (Open: Share · Boost · Edit · Cancel).
    expect(shouldCompactJobStepRow({ width: 311, chips: 4, hasPrimary: false })).toBe(false);
  });

  it("drops chips to icon-only when 3–4 buttons would squeeze a label at 375 and 320", () => {
    // Widths are the function's arguments; the app's rows measure 262 at 375
    // and 212 at 320. Primary + 3 chips (Confirmed, On the Way).
    expect(shouldCompactJobStepRow({ width: 311, chips: 3, hasPrimary: true })).toBe(true);
    // 375: primary + 4 chips (poster Disputed).
    expect(shouldCompactJobStepRow({ width: 311, chips: 4, hasPrimary: true })).toBe(true);
    // A narrower row still, primary + 2 chips.
    expect(shouldCompactJobStepRow({ width: 256, chips: 2, hasPrimary: true })).toBe(true);
    // …and the REAL 320 row is narrower than either of those.
    expect(shouldCompactJobStepRow({ width: 212, chips: 3, hasPrimary: true })).toBe(true);
  });

  it("measures WORDS: short labels stay labelled in a row a long word would not fit", () => {
    // Open at 375 (Share · Boost · Edit · Cancel, ~62px each): the longest word
    // needs ~48px, so the labels stay — the fixed 68px floor would have dropped them.
    expect(shouldCompactJobStepRow({ width: 267, chips: 4, hasPrimary: false, chipNeedPx: 48 })).toBe(false);
    expect(shouldCompactJobStepRow({ width: 267, chips: 4, hasPrimary: false, chipNeedPx: 72 })).toBe(true);
    // A primary that would need three lines at two shares forces icon-only chips.
    expect(shouldCompactJobStepRow({ width: 267, chips: 2, hasPrimary: true, chipNeedPx: 57, primaryNeedPx: 140 })).toBe(true);
  });

  it("leaves the primary real room once the chips are icon-only — there is no third rung", () => {
    // This replaced `shouldTightenJobStepPrimary` (owner, 2026-09-19): the old
    // rung answered "is the primary short?" by stepping it down to 12px and
    // stripping its icon, which is how the row ended up with three type sizes
    // and two shapes. `ICON_CHIP_PX` came down from 48 to the 44px tap floor
    // instead, so the primary gets the pixels without changing what it is.
    //
    // THE WIDTHS BELOW ARE THE FUNCTION'S ARGUMENTS, NOT THE APP'S ROW.
    // 311 and 256 were written here as "375" and "320" and were never
    // measured; the row is 262px at 375 and 212px at 320 (measured on prod,
    // 2026-09-19). At the real 212, four icon chips leave the primary 12px —
    // which is what shipped, and what `src/test/jobStepRowWidthFloor.test.tsx`
    // now fails on. These cases stay as pure arithmetic over the formula.
    expect(primaryRoomAfterCompaction({ width: 311, chips: 3 })).toBe(161);
    expect(primaryRoomAfterCompaction({ width: 256, chips: 4 })).toBe(56);
    // At 48px chips the same row left 40px, which is where the 12px rung came
    // from. The constant is the fix; this pins that it moved.
    expect(primaryRoomAfterCompaction({ width: 256, chips: 4 })).toBeGreaterThan(40);
    // …and the REAL 320 row, which is the number that matters: four chips
    // leave 12px, so a row of five controls cannot be drawn at 320 at all.
    // `allocateJobStepRow` is what stops it being drawn anyway.
    expect(primaryRoomAfterCompaction({ width: 212, chips: 4 })).toBe(12);
    expect(primaryRoomAfterCompaction({ width: 212, chips: 3 })).toBe(62);
    expect(primaryRoomAfterCompaction({ width: 0, chips: 4 })).toBe(0);
  });

  it("never compacts an unmeasured row or a lone button", () => {
    expect(shouldCompactJobStepRow({ width: 0, chips: 4, hasPrimary: true })).toBe(false);
    expect(shouldCompactJobStepRow({ width: 200, chips: 1, hasPrimary: false })).toBe(false);
    expect(shouldCompactJobStepRow({ width: 200, chips: 0, hasPrimary: true })).toBe(false);
  });

  it("the shell measures its row and marks it compact, so CSS hides chip labels (not the primary's)", async () => {
    // jsdom lays nothing out: give the row the 375 width and every measured
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
      expect(row.getAttribute("data-compact"), "4 buttons in 311px must drop the chips to icon-only").toBe("true");
      // The label is still the chip's accessible name — only its paint is hidden.
      const chips = [...row.children].filter((ch) => !ch.hasAttribute("data-job-step-primary"));
      expect(chips.length).toBe(3);
      for (const chip of chips) {
        expect((chip.getAttribute("aria-label") || chip.textContent || "").trim(), "an icon-only chip with no name").not.toBe("");
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
