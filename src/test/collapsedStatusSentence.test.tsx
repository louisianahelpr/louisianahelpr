/**
 * EVERY COLLAPSED CARD SAYS WHAT IT IS WAITING ON, ON BOTH TABS, AND IT FITS.
 *
 * Owner, 2026-09-19, looking at the collapsed cards on /posts:
 *   "in the box to the left of the dots should show what we are waiting on,
 *    like if the person is on their way or confirmed but now you need to
 *    confirm etc, remove the dots"
 *
 * ── WHAT THIS FILE REPLACES, AND WHY IT IS NOT A DELETION ─────────────────
 * `src/test/compactRailFits.test.tsx` asserted three things about the 16px-dot
 * rail that stood here for a few hours: that its geometry fitted a 212px card,
 * that its three states were distinguishable without colour, and that its dots
 * were not controls. The DOTS are gone, so assertions about dot geometry are
 * assertions about a thing that no longer exists — but the CLAIMS they carried
 * are not:
 *
 *   "it fits the card"        → every sentence fits, measured here, with the
 *                               same 212/262 prod row widths and the same
 *                               glyph model the row-width guard uses.
 *   "three states, no colour" → every tone carries an ICON and a WORD as well
 *                               as a hue, asserted on the rendered DOM.
 *   "not a control"           → the strip has no button and no link.
 *   "one sentence for AT"     → it announces as one sentence, not two loose
 *                               halves and not a duplicated sr-only copy.
 *
 * And it adds the claim the dots could never make: EVERY STATE HAS A SENTENCE,
 * and the sentence names whose move it is.
 *
 * ── WHERE THE INVENTORY COMES FROM ────────────────────────────────────────
 * Not a hand-written list. `POSTER_WAIT` / `HELPER_WAIT` are `Record<>`s keyed
 * by a closed union, so the module's own key set IS the inventory (a missing
 * sentence is a compile error, never a blank strip). The matrix below is built
 * from the `job_status` enum crossed with the stamps that move a job through
 * its life, driven through the real derivations, and the two sets are diffed.
 * An id no fixture reaches is a state nobody has proved reachable; an id the
 * matrix produces that the table lacks cannot exist (the compiler forbids it).
 *
 * PROOF THIS GUARD CAN FAIL (npm run vacuity). Each mutation restores a state
 * the app has actually been in or was one edit away from, and none is
 * satisfiable by a comment:
 *   1. Collapsing the poster's four eyebrow overrides back onto the bucket is
 *      exactly the dishonesty the owner's brief forbids — "Needs you · Your
 *      Helpr is on the way", asking a poster for something they cannot give.
 *   2. A longer sentence is the width class that shipped the 12px primary: a
 *      string nobody measured against the row it lives in.
 *   3. Dropping `flex-wrap` is the difference between two lines and a clipped
 *      one at 320 on the escalated dispute.
 *   4. Un-gating the strip on an expanded card puts it directly above the full
 *      tracker saying the same thing twice.
 *
 * @mutate src/components/job-card/jobStatusLine.ts | on_the_way: { detail: "Your Helpr is on the way", eyebrow: BUCKET_LABEL.waiting, tone: "them" }, | on_the_way: { detail: "Your Helpr is on the way" },
 * @mutate src/components/job-card/jobStatusLine.ts | confirm_arrival: { detail: "Confirm they arrived", eyebrow: BUCKET_LABEL.needs_you, tone: "you" }, | confirm_arrival: { detail: "Confirm they have arrived at the job and started work", eyebrow: BUCKET_LABEL.needs_you, tone: "you" },
 * @mutate src/components/job-card/JobStatusStrip.tsx | className="px-4 py-2 flex items-center gap-1.5 flex-wrap" | className="px-4 py-2 flex items-center gap-1.5 flex-nowrap"
 * @mutate src/pages/posts/PostedJobCard.tsx | {!isExpanded && (\n              <JobStatusStrip | {(true) && (\n              <JobStatusStrip
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
  hapticImpactForce: vi.fn(),
}));
vi.mock("@/components/PhotoProof", () => ({
  PhotoProofGroup: () => null,
  PhotoProofDialog: () => null,
  PhotoProofRequirementNote: () => null,
  PhotoProofCaptureChip: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
/* PARTIAL: only the COMPONENT is stubbed (it opens a realtime channel and
   queries). Its pure exports stay real — `ActiveJobSection` picks its step rung
   with `deriveCurrentStatusIdx`, and a constant there would decide the very
   thing these cases exercise. */
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()),
  JobTracking: () => <div data-testid="tracker" />,
}));
vi.mock("@/components/JobConfirmation", () => ({
  JobConfirmation: () => null,
  helperDayOfConfirmation: () => true,
}));
vi.mock("@/components/GroupJobHelpers", () => ({ GroupJobHelpers: () => null }));
vi.mock("@/pages/posts/SeriesStrip", () => ({ SeriesStrip: () => null }));
vi.mock("@/components/job-card/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/pages/jobs/JobPetCareSheet", () => ({ JobPetCareSheet: () => null }));
vi.mock("@/components/job-card/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));
vi.mock("@/hooks/useFundExistingJob", () => ({ useFundExistingJob: () => ({ fundJob: vi.fn(), fundingJobId: null }) }));

function makeSupabase() {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "neq", "in", "order", "limit", "insert", "update", "upsert", "delete", "gte", "lte", "is", "not", "filter"]) {
    chain[m] = vi.fn(() => chain);
  }
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

import {
  HELPER_WAIT,
  HELPER_WAIT_IDS,
  POSTER_WAIT,
  POSTER_WAIT_IDS,
  deriveHelperWait,
  derivePosterWait,
  helperStatusLine,
  posterStatusLine,
  type HelperWait,
  type PosterWait,
} from "@/components/job-card/jobStatusLine";
import { JobStatusStrip } from "@/components/job-card/JobStatusStrip";
import { AppliedJobCard } from "@/pages/jobs/AppliedJobCard";
import { PostedJobCard } from "@/pages/posts/PostedJobCard";
import { glyphPx } from "./jobStepRowCases";
import { Constants } from "@/integrations/supabase/types";

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

/* ═════════════════════════════ THE ARITHMETIC ════════════════════════════
 *
 * The strip's content box is the card's `px-4` box — the SAME box
 * `[data-job-step-row]` occupies, measured on prod on both engines
 * (src/test/jobStepRowWidthFloor.test.tsx): 212px at a 320 viewport, 262px at
 * 375. Laid out by JobStatusStrip as
 *
 *     icon(12) + gap(6) + EYEBROW + gap(6) + detail
 *
 * so one line has 212 − 12 − 6 = 194px at 320 and 262 − 12 − 6 = 244px at 375.
 *
 * TWO CONTRACTS, and the second is the one the owner's brief states:
 *   A. NEVER A THIRD LINE — each half alone is ≤194px, so the worst the strip
 *      can do at 320 is eyebrow on one line, detail on the next.
 *   B. ONE LINE AT 375 — eyebrow + 6 + detail ≤ 244px, on every state.
 *
 * jsdom lays nothing out and resolves no font, so widths come from the same
 * coarse glyph model `jobStepRowCases` already states for 11px label type,
 * imported rather than re-transcribed. The eyebrow is 10px uppercase with
 * 0.18em tracking, so its per-glyph advance is the 11px model scaled by 10/11
 * plus 1.8px of letter-spacing.
 */
const CARD_INNER_PX: Record<string, number> = { "320": 212, "375": 262 };
const ICON_PX = 12;
const GAP_PX = 6;
const lineBudget = (viewport: string) => CARD_INNER_PX[viewport] - ICON_PX - GAP_PX;

const detailPx = (s: string) => [...s].reduce((a, ch) => a + glyphPx(ch), 0);
const eyebrowPx = (s: string) =>
  [...s.toUpperCase()].reduce((a, ch) => a + (glyphPx(ch) * 10) / 11 + 1.8, 0);

/* ═══════════════════════════════ FIXTURES ═══════════════════════════════ */

const HELPER = "helper-1";
const POSTER = "poster-1";
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
/* CENTRAL, never UTC — `toISOString().slice(0,10)` names the next Central day
   after 19:00 Pacific and produced seven false reds on 2026-09-19.
   src/test/jobDayFixtureTimezone.test.ts guards the whole class. */
const TOMORROW = jobLocalDateISO(1);
const TODAY = jobLocalDateISO(0);
const YESTERDAY = jobLocalDateISO(-1);

const baseJob = {
  id: "job-1",
  title: "Pressure wash the driveway",
  description: "Front driveway and the walk to the porch.",
  category: "cleaning",
  budget: 120,
  status: "open",
  customer_id: POSTER,
  helper_id: null,
  location: "1103 Center St, New Iberia, LA 70560",
  date_needed: TOMORROW,
  start_time: "09:00",
  payment_status: "escrow",
} as unknown as Job;

const job = (over: Record<string, unknown>) => ({ ...baseJob, ...over }) as unknown as Job;

/**
 * ONE FIXTURE PER STATE, keyed by the id it must produce.
 *
 * Typed `Record<PosterWait, …>`, so the day a state is added to the union and
 * nothing here reaches it, this object stops compiling — the inventory and its
 * coverage cannot drift apart by one being edited without the other.
 */
const POSTER_FIXTURES: Record<
  PosterWait,
  { job: Job; pending?: number; completion?: { tipped: boolean; reviewed: boolean } }
> = {
  unfunded: { job: job({ payment_status: "unpaid", stripe_session_id: "cs_1" }) },
  in_review: { job: job({ status: "pending_approval" }) },
  applicants: { job: job({}), pending: 3 },
  listing_expired: { job: job({ expires_at: ago(2) }) },
  no_applicants: { job: job({ expires_at: ahead(48) }) },
  offer_out: { job: job({ direct_offer_status: "pending", offered_to_helper_id: HELPER }) },
  unconfirmed: { job: job({ status: "accepted", helper_id: HELPER, helper_confirmed_at: null }) },
  confirmed: { job: job({ status: "accepted", helper_id: HELPER, helper_confirmed_at: ago(4) }) },
  on_the_way: {
    job: job({
      status: "in_progress", helper_id: HELPER, date_needed: TODAY,
      helper_confirmed_at: ago(20), helper_on_the_way_at: ago(1),
      poster_confirmed_arrival_at: ago(1), poster_confirmed_working_at: ago(1),
    }),
  },
  confirm_arrival: {
    job: job({
      status: "in_progress", helper_id: HELPER, date_needed: TODAY,
      helper_confirmed_at: ago(20), helper_on_the_way_at: ago(2), helper_arrived_at: ago(1),
    }),
  },
  confirm_working: {
    job: job({
      status: "in_progress", helper_id: HELPER, date_needed: TODAY,
      helper_confirmed_at: ago(20), helper_arrived_at: ago(1), poster_confirmed_arrival_at: ago(1),
    }),
  },
  working: {
    job: job({
      status: "in_progress", helper_id: HELPER, date_needed: TODAY,
      helper_confirmed_at: ago(20), helper_arrived_at: ago(2),
      poster_confirmed_arrival_at: ago(2), poster_confirmed_working_at: ago(1),
    }),
  },
  approve: {
    job: job({
      status: "in_progress", helper_id: HELPER, date_needed: TODAY,
      helper_confirmed_at: ago(20), helper_completed_at: ago(1), poster_completed_at: null,
    }),
  },
  revision_out: {
    job: job({
      status: "revision_requested", helper_id: HELPER, date_needed: TODAY,
      helper_completed_at: ago(6), revision_requested_at: ago(3),
    }),
  },
  revision_fixed: {
    job: job({
      status: "revision_requested", helper_id: HELPER, date_needed: TODAY,
      revision_requested_at: ago(6), helper_completed_at: ago(1), poster_completed_at: ago(9),
      revision_completed_at: ago(1),
    }),
  },
  stalled: {
    // in_progress, both vouches in, nobody ever marked it done, and the job's
    // day is long gone — `completionStalled`'s own window.
    job: job({
      status: "in_progress", helper_id: HELPER, date_needed: jobLocalDateISO(-4),
      start_time: "09:00", helper_confirmed_at: ago(120), helper_arrived_at: ago(100),
      poster_confirmed_arrival_at: ago(100), poster_confirmed_working_at: ago(99),
    }),
  },
  overdue: {
    job: job({ status: "accepted", helper_id: HELPER, helper_confirmed_at: ago(48), date_needed: YESTERDAY }),
  },
  dispute: { job: job({ status: "disputed", helper_id: HELPER, dispute_status: "open" }) },
  dispute_escalated: { job: job({ status: "disputed", helper_id: HELPER, dispute_status: "escalated" }) },
  /* Q360: the bank took the money back from a job that finished and paid out;
     jobs.status still says 'completed'. */
  bank_dispute: { job: job({ status: "completed", helper_id: HELPER, payment_status: "chargeback" }) },
  /* Q360: a declined card on a job still open (the webhook's only precondition). */
  payment_failed: { job: job({ payment_status: "failed", stripe_session_id: "cs_1" }) },
  /* Q344: decided (job completed, dispute_status 'resolved') but the split has
     not moved the money. The flag is what the card attaches from the dispute row. */
  dispute_settling: {
    job: job({ status: "completed", helper_id: HELPER, payment_status: "escrow", dispute_status: "resolved", dispute_settling: true }),
    completion: { tipped: true, reviewed: true },
  },
  done_paid: {
    job: job({ status: "completed", helper_id: HELPER, payment_status: "released" }),
    completion: { tipped: true, reviewed: true },
  },
  /* The three loose-end finishes. Same JOB as done_paid — what separates them is
     the completion meta the card passes in, not anything on the row, so these
     fixtures are deliberately identical and the `completion` argument is what
     the cases below vary. */
  done_tip_open: {
    job: job({ status: "completed", helper_id: HELPER, payment_status: "released" }),
    completion: { tipped: false, reviewed: true },
  },
  done_review_open: {
    job: job({ status: "completed", helper_id: HELPER, payment_status: "released" }),
    completion: { tipped: true, reviewed: false },
  },
  done_both_open: {
    job: job({ status: "completed", helper_id: HELPER, payment_status: "released" }),
    completion: { tipped: false, reviewed: false },
  },
  cancelled: { job: job({ status: "cancelled" }) },
};

const makeApp = (over: Record<string, unknown>, jobOver: Record<string, unknown>) =>
  ({
    id: "app-1", job_id: "job-1", helper_id: HELPER, status: "accepted",
    posterName: "Pierre B.", created_at: ago(72),
    job: job(jobOver), ...over,
  }) as unknown as AppliedApp;

const HELPER_FIXTURES: Record<HelperWait, AppliedApp> = {
  job_gone: { id: "app-1", job_id: "job-1", helper_id: HELPER, status: "pending", job: null } as unknown as AppliedApp,
  not_selected: makeApp({ status: "rejected" }, { status: "accepted", helper_id: "someone-else" }),
  cancelled: makeApp({ status: "pending" }, { status: "cancelled" }),
  applied: makeApp({ status: "pending" }, { status: "open", expires_at: ahead(48) }),
  offer: makeApp({ status: "pending" }, { status: "open", direct_offer_status: "pending", offered_to_helper_id: HELPER }),
  confirm_booking: makeApp({}, { status: "accepted", helper_id: HELPER, helper_confirmed_at: null }),
  confirmed: makeApp({}, { status: "accepted", helper_id: HELPER, helper_confirmed_at: ago(4) }),
  today: makeApp({}, { status: "accepted", helper_id: HELPER, helper_confirmed_at: ago(4), date_needed: TODAY }),
  on_the_way: makeApp({}, {
    status: "in_progress", helper_id: HELPER, date_needed: TODAY,
    helper_confirmed_at: ago(20), helper_on_the_way_at: ago(1),
  }),
  working: makeApp({}, {
    status: "in_progress", helper_id: HELPER, date_needed: TODAY,
    helper_confirmed_at: ago(20), helper_arrived_at: ago(1),
  }),
  submitted: makeApp({}, {
    status: "in_progress", helper_id: HELPER, date_needed: TODAY,
    helper_completed_at: ago(1), poster_completed_at: null,
  }),
  revision: makeApp({}, {
    status: "revision_requested", helper_id: HELPER, date_needed: TODAY,
    helper_completed_at: ago(6), revision_requested_at: ago(3),
  }),
  revision_sent: makeApp({}, {
    status: "revision_requested", helper_id: HELPER, date_needed: TODAY,
    revision_requested_at: ago(6), helper_completed_at: ago(1), revision_completed_at: ago(1),
  }),
  overdue: makeApp({}, { status: "accepted", helper_id: HELPER, helper_confirmed_at: ago(48), date_needed: YESTERDAY }),
  dispute: makeApp({}, { status: "disputed", helper_id: HELPER, dispute_status: "open" }),
  dispute_escalated: makeApp({}, { status: "disputed", helper_id: HELPER, dispute_status: "escalated" }),
  bank_dispute: makeApp({}, { status: "completed", helper_id: HELPER, payment_status: "chargeback" }),
  payment_failed: makeApp({ status: "pending" }, {
    status: "open", payment_status: "failed", direct_offer_status: "pending", offered_to_helper_id: HELPER,
  }),
  dispute_settling: makeApp({}, { status: "completed", helper_id: HELPER, payment_status: "escrow", dispute_status: "resolved", dispute_settling: true }),
  done_paid: makeApp({}, { status: "completed", helper_id: HELPER, payment_status: "released" }),
};

/* ═══════════════════════════ 1 — THE INVENTORY ══════════════════════════ */

describe("every state a collapsed card can be in has a sentence", () => {
  it("there ARE states to cover — inventory floor", () => {
    // Without this, every assertion below is trivially true of an empty table.
    expect(POSTER_WAIT_IDS.length, "the poster's table is empty").toBeGreaterThanOrEqual(20);
    expect(HELPER_WAIT_IDS.length, "the helper's table is empty").toBeGreaterThanOrEqual(16);
  });

  it("Posts: the fixtures REACH every id in the table — nothing unproven", () => {
    const reached = new Set(
      POSTER_WAIT_IDS.map((id) =>
        derivePosterWait(
          POSTER_FIXTURES[id].job,
          POSTER_FIXTURES[id].pending ?? 0,
          undefined,
          POSTER_FIXTURES[id].completion,
        ),
      ),
    );
    const missing = POSTER_WAIT_IDS.filter((id) => !reached.has(id));
    expect(
      missing,
      `no fixture produces these poster states, so their sentences are unproven: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("Posts: each fixture produces the id it is filed under", () => {
    for (const id of POSTER_WAIT_IDS) {
      const f = POSTER_FIXTURES[id];
      expect(
        derivePosterWait(f.job, f.pending ?? 0, undefined, f.completion),
        `the ${id} fixture no longer derives ${id}`,
      ).toBe(id);
    }
  });

  it("Jobs: the fixtures REACH every id in the table", () => {
    const reached = new Set(HELPER_WAIT_IDS.map((id) => deriveHelperWait(HELPER_FIXTURES[id])));
    const missing = HELPER_WAIT_IDS.filter((id) => !reached.has(id));
    expect(missing, `unproven helper states: ${missing.join(", ")}`).toEqual([]);
  });

  it("Jobs: each fixture produces the id it is filed under", () => {
    for (const id of HELPER_WAIT_IDS) {
      expect(deriveHelperWait(HELPER_FIXTURES[id]), `the ${id} fixture no longer derives ${id}`).toBe(id);
    }
  });

  it("no sentence is blank, on either side", () => {
    for (const [id, copy] of Object.entries({ ...POSTER_WAIT, ...HELPER_WAIT })) {
      expect(copy.detail.trim().length, `${id} has no sentence`).toBeGreaterThan(3);
    }
  });

  it("every job_status the DB can hold is exercised by the matrix", () => {
    // DERIVED, not transcribed. This used to be an eight-entry array with a
    // comment above it claiming the states "come from the enum" — they did
    // not, and `literalRegistryGuard` / `jobStatusExhaustive` both caught the
    // lie the moment this file landed. A hand-kept copy of a database-owned
    // set cannot fail when the database gains a ninth status: the list and
    // the oracle would be the same object.
    const STATUSES: readonly string[] = Constants.public.Enums.job_status;
    const posterStatuses = new Set(POSTER_WAIT_IDS.map((id) => POSTER_FIXTURES[id].job.status as string));
    const helperStatuses = new Set(
      HELPER_WAIT_IDS.map((id) => HELPER_FIXTURES[id].job?.status as string).filter(Boolean),
    );
    for (const s of STATUSES) {
      expect(posterStatuses.has(s), `no poster fixture is in status ${s}`).toBe(true);
    }
    // The helper never sees `pending_approval` (an unapproved post is not in
    // anyone's feed), so its fixture is the poster's alone; every other status
    // must be on both sides.
    for (const s of STATUSES.filter((x) => x !== "pending_approval")) {
      expect(helperStatuses.has(s), `no helper fixture is in status ${s}`).toBe(true);
    }
  });
});

/* ═══════════════════ 2 — IT NAMES WHOSE MOVE IT IS ══════════════════════ */

describe("the sentence says whose move it is, and does not lie about it", () => {
  const OWED_BY_READER = new Set(["Needs You"]);

  it("Posts: no line claims the poster must act while the ball is elsewhere", () => {
    /* The four honesty cases — the ones where `postedActivityBucket` says
       Needs You and nothing is actually owed by the reader. Each is a reported
       disagreement with the bucket, not a copy preference. */
    for (const id of ["on_the_way", "working", "revision_out"] as PosterWait[]) {
      const f = POSTER_FIXTURES[id];
      const line = posterStatusLine(f.job, f.pending ?? 0, undefined, f.completion);
      expect(
        OWED_BY_READER.has(line.eyebrow),
        `${id} reads "${line.eyebrow} · ${line.detail}" — it is asking the poster for something ` +
          `only the Helpr can give`,
      ).toBe(false);
    }
  });

  it("Posts: the states that ARE the poster's move say so", () => {
    for (const id of ["confirm_arrival", "confirm_working", "approve", "revision_fixed", "applicants", "unfunded"] as PosterWait[]) {
      const f = POSTER_FIXTURES[id];
      const line = posterStatusLine(f.job, f.pending ?? 0, undefined, f.completion);
      expect(line.eyebrow, `${id} does not tell the poster it is their move`).toBe("Needs You");
    }
  });

  it("Jobs: a Helpr who has already resubmitted is not told they still owe one", () => {
    const line = helperStatusLine(HELPER_FIXTURES.revision_sent);
    expect(OWED_BY_READER.has(line.eyebrow), `revision_sent reads "${line.eyebrow}"`).toBe(false);
  });

  it("the two sides say DIFFERENT things about the same job", () => {
    // One job, two readers. If these ever matched, the line would be about the
    // job's status rather than about whose move it is — which is the thing the
    // dots already did and the owner asked to replace.
    const submitted = posterStatusLine(POSTER_FIXTURES.approve.job);
    const theirs = helperStatusLine(HELPER_FIXTURES.submitted);
    expect(submitted.detail).not.toBe(theirs.detail);
    expect(submitted.eyebrow).toBe("Needs You");
    expect(theirs.eyebrow).toBe("Waiting");
  });

  it("a calendar word never sits over an owed tap — the future-dated in_progress job", () => {
    /* FINDING #5, pinned. Both bucketers lift only TODAY's work into Needs You
       (`jobIsLive`), so an `in_progress` job dated tomorrow — a Helpr who
       started early — buckets to Scheduled. Without the eyebrow overrides on
       `confirm_arrival` / `confirm_working` / the Helpr's `on_the_way` and
       `working`, the strip read "Scheduled · Confirm they arrived": a calm
       word over a tap the reader owes right now. */
    const early = job({
      status: "in_progress", helper_id: HELPER, date_needed: jobLocalDateISO(2),
      helper_confirmed_at: ago(20), helper_arrived_at: ago(1),
    });
    const line = posterStatusLine(early);
    expect(line.id).toBe("confirm_arrival");
    expect(
      line.eyebrow,
      `a job whose Helpr arrived early reads "${line.eyebrow} · ${line.detail}"`,
    ).toBe("Needs You");

    const theirs = helperStatusLine(makeApp({}, {
      status: "in_progress", helper_id: HELPER, date_needed: jobLocalDateISO(2),
      helper_confirmed_at: ago(20), helper_arrived_at: ago(1),
    }));
    expect(theirs.id).toBe("working");
    expect(theirs.eyebrow, `the Helpr mid-job reads "${theirs.eyebrow} · ${theirs.detail}"`).toBe("Needs You");
  });

  it("the owed CONFIRMATION is flagged, on both sides", () => {
    expect(posterStatusLine(POSTER_FIXTURES.confirm_arrival.job).owesConfirmation).toBe(true);
    expect(posterStatusLine(POSTER_FIXTURES.working.job).owesConfirmation).toBe(false);
    expect(helperStatusLine(HELPER_FIXTURES.confirm_booking).owesConfirmation).toBe(true);
  });
});

/* ═══════════════════════════ 3 — IT FITS ════════════════════════════════ */

describe("every sentence fits the collapsed card it sits in", () => {
  const lines = [
    ...POSTER_WAIT_IDS.map((id) => {
      const f = POSTER_FIXTURES[id];
      return { side: "Posts", ...posterStatusLine(f.job, f.pending ?? 0) };
    }),
    ...HELPER_WAIT_IDS.map((id) => ({ side: "Jobs", ...helperStatusLine(HELPER_FIXTURES[id]) })),
  ];

  it("there are lines to measure — inventory floor", () => {
    expect(lines.length, "nothing was measured").toBeGreaterThanOrEqual(36);
  });

  it("NEVER A THIRD LINE at 320: each half alone fits the 194px line", () => {
    const budget = lineBudget("320");
    for (const l of lines) {
      expect(
        eyebrowPx(l.eyebrow),
        `${l.side}/${l.id}: the eyebrow "${l.eyebrow}" needs ${eyebrowPx(l.eyebrow).toFixed(1)}px ` +
          `of a ${budget}px line — it wraps on its own, so the strip is three lines deep`,
      ).toBeLessThanOrEqual(budget);
      expect(
        detailPx(l.detail),
        `${l.side}/${l.id}: "${l.detail}" needs ${detailPx(l.detail).toFixed(1)}px of a ${budget}px ` +
          `line. Shorten the sentence — do not shrink the type and do not clip it.`,
      ).toBeLessThanOrEqual(budget);
    }
  });

  /*
   * MEASURES WHAT IS RENDERED. The strip stopped drawing the eyebrow on
   * 2026-09-21 (owner: the left should carry the reason, not the tab's own
   * word), so a budget spending eyebrow + gap + detail was charging the line
   * for text that is not on screen — and it would have rejected honest copy for
   * the width of an invisible label. Icon(12) + gap(6) + detail is the layout.
   *
   * The eyebrow is still in the DATA and still asserted elsewhere in this file;
   * it is only no longer part of the geometry.
   */
  it("ONE LINE at 375: the detail fits the row left after the icon", () => {
    const budget = lineBudget("375");
    for (const l of lines) {
      // `lineBudget` has already taken the icon and the gap off the row.
      const need = detailPx(l.detail);
      expect(
        need,
        `${l.side}/${l.id}: "${l.detail}" needs ${need.toFixed(1)}px of a ${budget}px row at 375`,
      ).toBeLessThanOrEqual(budget);
    }
  });

  it("EVERY line now fits ONE line at 320 — nothing is allowed to wrap", () => {
    // It used to be 36 of 38, the two exceptions being "ADMIN REVIEWING ·
    // Payment on hold" at 210.3px against a 194px budget. Dropping the eyebrow
    // from the rendering took the uppercase label and its 0.18em tracking off
    // every line, and the allow-list emptied itself — so it is empty here
    // rather than carrying two entries nothing reaches. A NEW line that wraps
    // now fails outright, which is stricter than what this replaced.
    const budget = lineBudget("320");
    const twoLine = lines.filter((l) => detailPx(l.detail) > budget);
    expect(
      twoLine.map((l) => `${l.side}/${l.id}`).sort(),
      "a new sentence has been allowed to wrap at 320 without anyone deciding to let it",
    ).toEqual([]);
  });

  it("the strip is allowed to wrap — otherwise the two-line case is a clipped one", () => {
    render(<JobStatusStrip line={posterStatusLine(POSTER_FIXTURES.dispute_escalated.job)} />);
    const strip = document.querySelector("[data-job-status-strip]")!;
    expect(
      strip.classList.contains("flex-wrap"),
      "the strip is flex-nowrap: at 320 the escalated dispute cannot drop its detail to a " +
        "second line, so it squeezes or overflows instead",
    ).toBe(true);
  });
});

/* ══════════════════ 4 — THE STRIP ITSELF, RENDERED ══════════════════════ */

describe("the strip reads without colour, announces as one sentence, and is not a control", () => {
  function renderStrip(id: PosterWait) {
    document.body.innerHTML = "";
    const f = POSTER_FIXTURES[id];
    render(<JobStatusStrip line={posterStatusLine(f.job, f.pending ?? 0)} />);
    return document.querySelector<HTMLElement>("[data-job-status-strip]")!;
  }

  it("every tone carries an ICON and a WORD, not just a hue (WCAG 1.4.1)", () => {
    const seen = new Set<string>();
    for (const id of POSTER_WAIT_IDS) {
      const strip = renderStrip(id);
      seen.add(strip.dataset.jobStatusTone!);
      expect(strip.querySelector("svg"), `${id} draws no icon`).not.toBeNull();
      expect(strip.textContent?.trim().length, `${id} renders no words`).toBeGreaterThan(8);
    }
    // More than one tone is actually in play, so "every tone" is not one tone.
    expect(seen.size, `only ${seen.size} tone(s) across the whole poster table`).toBeGreaterThanOrEqual(4);
  });

  it("it announces as ONE sentence, with no duplicated sr-only copy", () => {
    const strip = renderStrip("confirm_arrival");
    expect(strip.textContent).toContain("Needs You");
    expect(strip.textContent).toContain("Confirm they arrived");
    // The old rail said "Job progress: step 5 of 8, Working". That aria-label
    // went with the dots, and nothing may have brought it back.
    expect(document.body.textContent).not.toMatch(/Job progress: step/);
    // One rendering of each half — a duplicated sr-only copy makes a screen
    // reader say the line twice.
    expect(strip.textContent!.match(/Confirm they arrived/g)).toHaveLength(1);
  });

  it("it is not a control — the card's own expand gesture is underneath", () => {
    const strip = renderStrip("confirm_arrival");
    expect(strip.querySelectorAll("button, a[href]")).toHaveLength(0);
  });

  it("the dispute keeps its own words, its own tone and its own hook", () => {
    const open = renderStrip("dispute");
    expect(open.textContent).toContain("Dispute open");
    expect(open.textContent).toContain("Payment on hold");
    expect(open.dataset.jobStatusTone).toBe("alarm");
    expect(open.hasAttribute("data-dispute-open-badge")).toBe(true);
    const esc = renderStrip("dispute_escalated");
    expect(esc.textContent).toContain("Admin reviewing");
  });
});

/* ════════════════ 5 — THE CARDS ACTUALLY MOUNT IT ══════════════════════ */

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const noop = () => {};

function renderPosted(
  j: Job,
  expanded: boolean,
  pending = 0,
  /* The loose-end states are only distinguishable with this, so the render
     test has to hand the card what the real page hands it. */
  completion?: { tipped: boolean; reviewed: boolean },
) {
  document.body.innerHTML = "";
  return wrap(
    <PostedJobCard
      job={j}
      applicantCounts={{}}
      pendingApplicantCounts={{ [j.id]: pending }}
      expandedJobIds={new Set(expanded ? [j.id] : [])}
      toggleExpandedJobId={noop}
      helperNames={{ [HELPER]: "Hallie H." }}
      helperAvatars={{ [HELPER]: null }}
      completedJobMeta={completion ? { [j.id]: completion } : {}}
      userId={POSTER}
      onBoost={noop} onEdit={noop} onCancel={noop} onComplete={noop} completingJobId={null}
      onNoShow={noop} onTip={noop} onReview={noop} onDispute={noop} onReport={noop}
      onViewDispute={noop} onConfirmArrival={noop} confirmingArrivalJobId={null}
      onConfirmWorking={noop} confirmingWorkingJobId={null}
      onLoadApplications={noop} onLoadInlineApplicants={noop}
      inlineApplicants={{}} loadingApplicants={{}} applicantErrors={{}}
      onActionComplete={noop}
    />,
  );
}

function renderApplied(app: AppliedApp, expanded: boolean) {
  document.body.innerHTML = "";
  return wrap(
    <AppliedJobCard
      app={app}
      expandedJobIds={new Set(expanded ? [app.job_id] : [])}
      toggleExpandedJobId={noop}
      helperReviewedJobIds={new Set()}
      userId={HELPER}
      onHelperResponse={noop} respondingHelperAppId={null}
      onComplete={noop} completingJobId={null}
      onResolveRevision={noop} onHelperReview={noop}
      onDispute={noop} onViewDispute={noop} onRefresh={noop}
      disputeResponse="" setDisputeResponse={noop}
      respondingJobId={null} setRespondingJobId={noop}
      submittingResponse={false} setSubmittingResponse={noop}
      withdrawingAppId={null} setWithdrawTarget={noop}
      uploadingAttachment={null} editingMessageAppId={null}
      setEditingMessageAppId={noop} editMessageText="" setEditMessageText={noop}
      savingMessage={false} handleSaveMessage={noop}
      handleAddAttachment={noop} handleRemoveAttachment={noop}
    />,
  );
}

const strip = () => document.querySelector<HTMLElement>("[data-job-status-strip]");

describe("BOTH cards mount it, collapsed only", () => {
  it("Posts: every collapsed state draws exactly one strip, saying its own line", () => {
    for (const id of POSTER_WAIT_IDS) {
      const f = POSTER_FIXTURES[id];
      renderPosted(f.job, false, f.pending ?? 0, f.completion);
      const els = document.querySelectorAll("[data-job-status-strip]");
      expect(els, `Posts/${id}: ${els.length} strips on one collapsed card`).toHaveLength(1);
      expect((els[0] as HTMLElement).dataset.jobStatusStrip, `Posts/${id}`).toBe(id);
    }
  });

  it("Posts: expanded, the strip is gone — the body says all of it below", () => {
    renderPosted(POSTER_FIXTURES.confirm_arrival.job, true);
    expect(strip(), "the strip is on an expanded card, directly above a tracker saying the same thing").toBeNull();
  });

  it("Jobs: every collapsed state draws exactly one strip", () => {
    for (const id of HELPER_WAIT_IDS) {
      // The three terminal states render the MINIMAL card, which states the
      // same outcome in prose (`describeCancellation`, which also says WHO) —
      // a recorded decision, not a gap. Everything else wears a strip.
      const minimal = id === "not_selected" || id === "cancelled" || id === "job_gone";
      renderApplied(HELPER_FIXTURES[id], false);
      const els = document.querySelectorAll("[data-job-status-strip]");
      expect(els, `Jobs/${id}: ${els.length} strips`).toHaveLength(minimal ? 0 : 1);
      if (!minimal) expect((els[0] as HTMLElement).dataset.jobStatusStrip, `Jobs/${id}`).toBe(id);
    }
  });

  it("Jobs: expanded, the strip is gone", () => {
    renderApplied(HELPER_FIXTURES.working, true);
    expect(strip()).toBeNull();
  });

  it("NO TRACKER ON ANY COLLAPSED CARD — contested included (owner's reversal)", () => {
    // "the live tracker should also be collapsed for disputes unless its
    // clicked to expand it" (owner, 2026-09-19), superseding that same
    // morning's un-gate for `disputed` / `revision_requested`.
    for (const id of ["dispute", "dispute_escalated", "revision_out", "revision_fixed"] as PosterWait[]) {
      renderPosted(POSTER_FIXTURES[id].job, false);
      expect(
        screen.queryByTestId("tracker"),
        `Posts/${id}: a collapsed card still mounts the tracker — and with it a realtime ` +
          `channel per row of the list`,
      ).toBeNull();
      expect(strip(), `Posts/${id}: no strip either, so the card says nothing at all`).not.toBeNull();
    }
    renderApplied(HELPER_FIXTURES.dispute, false);
    expect(screen.queryByTestId("tracker"), "Jobs/dispute: tracker on a collapsed card").toBeNull();
  });

  it("no compact dot rail survives anywhere", () => {
    renderPosted(POSTER_FIXTURES.working.job, false);
    expect(document.querySelector("[data-job-rail-compact]"), "the dots are back").toBeNull();
    renderApplied(HELPER_FIXTURES.working, false);
    expect(document.querySelector("[data-job-rail-compact]"), "the dots are back on My Jobs").toBeNull();
  });
});
