/**
 * Built-in sample data for the admin job-page preview (/admin/preview/job, owner 2026-11-01: "is there a way I can
 * just test clicking each section of the steps to see each stage of this").
 *
 * Every stage is one made-up job, seen by its poster or its Helpr. Nothing here is a real row: the ids are fixed
 * made-up UUIDs and the preview's backend (previewBackend.ts) answers the job page's reads from this, so the page
 * never reads or writes a real job.
 */
import type { JobPageRow } from "@/pages/jobs/jobPage/useJobPage";

export const PREVIEW_STAGES = [
  // The tracker's eight steps, in its order (jobProgressState.ts JOB_PROGRESS_STEPS).
  { key: "posted", label: "Posted" },
  { key: "offered", label: "Offered" },
  { key: "hired", label: "Hired" },
  { key: "confirmed", label: "Confirmed" },
  { key: "on_the_way", label: "On the way" },
  { key: "arrived", label: "Arrived" },
  { key: "working", label: "Working" },
  { key: "done", label: "Done" },
  // The other states the code knows.
  { key: "cancelled", label: "Cancelled" },
  { key: "expired", label: "Expired" },
  { key: "no_show", label: "No-show" },
  { key: "disputed", label: "Disputed" },
  { key: "crew", label: "Crew job" },
  { key: "instant_pending", label: "Instant booking pending" },
  // Audit 1102b: the stages it could not walk.
  { key: "approve", label: "Approve before payment" },
  { key: "revision", label: "Fix asked for" },
  { key: "tip", label: "Tip" },
  { key: "refund", label: "Refund asked" },
  { key: "recurring", label: "Recurring visits" },
  { key: "late_cancel_poster", label: "Late cancel by poster" },
  { key: "late_cancel_helpr", label: "Late cancel by Helpr" },
  { key: "cancel_sheet", label: "Cancel sheet" },
  { key: "continue_day", label: "Another day set" },
] as const;

export type PreviewStage = (typeof PREVIEW_STAGES)[number]["key"];
export type PreviewViewer = "poster" | "helpr";

const PREVIEW_POSTER_ID = "00000000-0000-4000-a000-000000000001";
const PREVIEW_HELPR_ID = "00000000-0000-4000-a000-000000000002";
const PREVIEW_CREWMATE_ID = "00000000-0000-4000-a000-000000000003";

/** A made-up job id per stage, so each stage has its own page cache. */
function previewJobId(stage: PreviewStage): string {
  const n = PREVIEW_STAGES.findIndex((s) => s.key === stage) + 1;
  return `00000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
}

export function isPreviewStage(v: string | null | undefined): v is PreviewStage {
  return PREVIEW_STAGES.some((s) => s.key === v);
}

/** What the preview's backend answers for one stage and one side. */
export interface PreviewSample {
  stage: PreviewStage;
  viewer: PreviewViewer;
  /** The signed-in member the page is drawn for. */
  userId: string;
  jobId: string;
  job: JobPageRow & { expires_at?: string | null; instant_decline_until?: string | null; cancellation_reason?: string | null };
  /** Whether the viewer is a party (the `jobs` read answers), else the job comes from the browse view. */
  party: boolean;
  /** Every application on the job (the poster's applicant count). */
  applications: Array<{ status: string; closed_reason: string | null; helper_id: string }>;
  trackingStatus: string | null;
  crew: string[];
  /** The viewer's pending direct offer (instant booking), when there is one. */
  pendingOffer: { id: string; instant_decline_until: string | null } | null;
  offeredTo: string | null;
  profiles: Array<{ id: string; full_name: string; avatar_url: string | null; created_at: string }>;
  candidates: Array<{ helper_id: string; display_name: string; avatar_url: string | null; jobs_done: number; rating: number | null; review_count: number }>;
  /** Every other read RPC the page makes, by name (an RPC not here is answered null and reported, never sent). */
  reads: Record<string, unknown>;
  /** Every other table the page reads, by name (a table not here is answered [] and reported, never sent). */
  tables: Record<string, unknown[]>;
  /** A control the preview presses once the page has drawn, to open its sheet (the Cancel sheet stage). */
  opens: string | null;
  /**
   * What is drawn: the job page, or (the Cancel sheet stage seen by the Helpr) the Helpr's own Working card, where
   * their cancel sheet lives (ConfirmedSection, helper_cancel_booking).
   */
  draws: "job_page" | "helpr_working_card";
  /** The poster's cancel quote (create-payment cancel_quote), answered silently: it is a read. */
  cancelQuote: { can_cancel: boolean; fee_cents: number; fee_percent: number; back_to_you_cents: number; charge_state: "hold" };
  /**
   * The final actions the preview answers with the success shape their screen expects (audit 1102e: "Cancelling…"
   * never finished), by RPC name. The page then draws the stage after it (JobPreviewPage AFTER_ACTION).
   */
  actions: Record<string, unknown>;
}

const DAY = 24 * 60 * 60 * 1000;

function isoDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The made-up job at one stage. `now` is injectable so a test can pin the clock. */
export function previewSample(stage: PreviewStage, viewer: PreviewViewer, now: number = Date.now()): PreviewSample {
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const jobId = previewJobId(stage);
  const userId = viewer === "poster" ? PREVIEW_POSTER_ID : PREVIEW_HELPR_ID;
  const base: PreviewSample["job"] = {
    id: jobId,
    title: "Rake the front yard and bag the leaves",
    description: "Front and side yard, about a quarter acre. Bags and a rake are in the shed by the driveway. Please stack the full bags at the curb.",
    category: "yard_work",
    budget: 120,
    // Far enough out that the day-before confirm has not opened (the Hired step); stages past it move the date in.
    date_needed: isoDate(now + 3 * DAY),
    start_time: "09:00",
    is_flexible_schedule: false,
    location: "412 Oak Street, Lafayette, LA 70501",
    customer_id: PREVIEW_POSTER_ID,
    helper_id: null,
    status: "open",
    payment_status: "escrow",
    urgent_fee: null,
    helpers_needed: 1,
    is_group_job: false,
    photos: [],
    scope_video_url: null,
    helper_fee_flat_cents: 70,
    helper_fee_percent: 5,
    poster_fee_flat_cents: null,
    require_photo_proof: false,
    proof_before_urls: [],
    proof_after_urls: [],
    direct_offer_status: null,
    expires_at: new Date(now + 7 * DAY).toISOString(),
  };
  const hired = { helper_id: PREVIEW_HELPR_ID, status: "accepted", helper_confirmed_at: ago(60 * 24) };
  const today = { date_needed: isoDate(now), start_time: null as string | null };
  const bothIn = { helper_dayof_confirmed_at: ago(180), poster_confirmed_at: ago(170) };

  let job = base;
  let applications: PreviewSample["applications"] = [];
  let trackingStatus: string | null = null;
  let crew: string[] = [];
  let pendingOffer: PreviewSample["pendingOffer"] = null;
  let offeredTo: string | null = null;
  let candidates: PreviewSample["candidates"] = [];
  /** This stage's own rows, over the empty defaults below. */
  let extraTables: Record<string, unknown[]> = {};
  const accepted = { status: "accepted", closed_reason: null, helper_id: PREVIEW_HELPR_ID };

  switch (stage) {
    case "posted":
      // Two other Helprs applied; the Helpr viewing has not, so they see Apply.
      applications = [
        { status: "pending", closed_reason: null, helper_id: PREVIEW_CREWMATE_ID },
        { status: "pending", closed_reason: null, helper_id: "00000000-0000-4000-a000-000000000004" },
      ];
      candidates = [
        { helper_id: PREVIEW_HELPR_ID, display_name: "Eli R.", avatar_url: null, jobs_done: 14, rating: 4.9, review_count: 11 },
        { helper_id: PREVIEW_CREWMATE_ID, display_name: "Maya T.", avatar_url: null, jobs_done: 6, rating: 4.8, review_count: 5 },
      ];
      break;
    case "offered":
      job = { ...base, helper_id: PREVIEW_HELPR_ID, status: "accepted", direct_offer_status: "pending" };
      applications = [accepted];
      pendingOffer = { id: jobId, instant_decline_until: null };
      offeredTo = PREVIEW_HELPR_ID;
      break;
    case "hired":
      job = { ...base, ...hired };
      applications = [accepted];
      break;
    case "confirmed":
      job = { ...base, ...hired, date_needed: isoDate(now + DAY), helper_dayof_confirmed_at: ago(30) };
      applications = [accepted];
      break;
    case "on_the_way":
      job = { ...base, ...hired, ...today, ...bothIn, helper_on_the_way_at: ago(10) };
      applications = [accepted];
      trackingStatus = "on_the_way";
      break;
    case "arrived":
      job = { ...base, ...hired, ...today, ...bothIn, status: "in_progress", helper_on_the_way_at: ago(40), helper_arrived_at: ago(5) };
      applications = [accepted];
      trackingStatus = "arrived";
      break;
    case "working":
      job = {
        ...base, ...hired, ...today, ...bothIn, status: "in_progress", helper_on_the_way_at: ago(90), helper_arrived_at: ago(60),
        poster_confirmed_arrival_at: ago(58), poster_confirmed_working_at: ago(55),
      };
      applications = [accepted];
      trackingStatus = "in_progress";
      break;
    case "done":
      job = {
        ...base, ...hired, ...today, ...bothIn, status: "completed", payment_status: "payout_pending", helper_on_the_way_at: ago(240),
        helper_arrived_at: ago(210), poster_confirmed_arrival_at: ago(208), poster_confirmed_working_at: ago(205),
        helper_completed_at: ago(60), poster_completed_at: ago(30), completed_at: ago(30), payout_scheduled_at: ago(-60 * 24),
      };
      applications = [accepted];
      trackingStatus = "completed";
      break;
    case "cancelled":
      job = { ...base, ...hired, status: "cancelled", payment_status: "refunded" };
      applications = [{ status: "closed", closed_reason: "job_cancelled", helper_id: PREVIEW_HELPR_ID }];
      break;
    case "expired":
      // How auto-expire-jobs closes a listing nobody took (src/lib/expiredListing.ts): cancelled, no Helpr, its fixed reason.
      job = { ...base, status: "cancelled", payment_status: "refunded", expires_at: ago(60 * 24), cancellation_reason: "Job listing expired with no Helpr hired" };
      // Prod closes an expired listing's applications (196 of 196 rejected, audit 1102b).
      applications = [{ status: "rejected", closed_reason: "job_expired", helper_id: PREVIEW_HELPR_ID }];
      break;
    case "no_show":
      // The Helpr never came: the poster reported a no-show and the job was cancelled and refunded.
      job = { ...base, ...hired, ...today, ...bothIn, status: "cancelled", payment_status: "refunded" };
      applications = [{ status: "closed", closed_reason: "no_show", helper_id: PREVIEW_HELPR_ID }];
      break;
    case "disputed":
      job = {
        ...base, ...hired, ...today, ...bothIn, status: "in_progress", helper_on_the_way_at: ago(240), helper_arrived_at: ago(210),
        poster_confirmed_arrival_at: ago(208), poster_confirmed_working_at: ago(205), helper_completed_at: ago(60), has_active_dispute: true,
      };
      applications = [accepted];
      trackingStatus = "completed";
      break;
    case "crew":
      job = { ...base, ...today, ...bothIn, title: "Move a couch and boxes upstairs", description: "A couch and about twenty boxes from the truck to the second floor. The stairs are narrow; a dolly is in the garage.", category: "moving", budget: 300, is_group_job: true, helpers_needed: 3, status: "accepted", helper_confirmed_at: ago(60 * 24) };
      applications = [accepted, { status: "accepted", closed_reason: null, helper_id: PREVIEW_CREWMATE_ID }];
      crew = [PREVIEW_HELPR_ID, PREVIEW_CREWMATE_ID];
      break;
    case "approve":
      // The Helpr marked it done; the poster has not approved, so the pay is still held.
      job = {
        ...base, ...hired, ...today, ...bothIn, status: "in_progress", helper_on_the_way_at: ago(240), helper_arrived_at: ago(210),
        poster_confirmed_arrival_at: ago(208), poster_confirmed_working_at: ago(205), helper_completed_at: ago(20),
      };
      applications = [accepted];
      trackingStatus = "completed";
      break;
    case "revision":
      job = {
        ...base, ...hired, ...today, ...bothIn, status: "revision_requested", helper_on_the_way_at: ago(240), helper_arrived_at: ago(210),
        poster_confirmed_arrival_at: ago(208), poster_confirmed_working_at: ago(205), helper_completed_at: ago(90),
        revision_note: "The side yard by the fence still has leaves, and two bags were left by the porch instead of the curb.",
        revision_deadline: new Date(now + 22 * 60 * 60_000).toISOString(),
      };
      applications = [accepted];
      trackingStatus = "completed";
      break;
    case "refund":
      // The Helpr marked it done and the poster asked for part of the money back instead of approving (refund_requests).
      job = {
        ...base, ...hired, ...today, ...bothIn, status: "in_progress", helper_on_the_way_at: ago(240), helper_arrived_at: ago(210),
        poster_confirmed_arrival_at: ago(208), poster_confirmed_working_at: ago(205), helper_completed_at: ago(60),
      };
      applications = [accepted];
      trackingStatus = "completed";
      extraTables = {
        refund_requests: [{
          id: "00000000-0000-4000-d000-000000000001", job_id: jobId, requester_id: PREVIEW_POSTER_ID, responder_id: PREVIEW_HELPR_ID,
          refund_scope: "part", amount_cents: 4000, budget_cents: 12000, reason: "Only the front yard was done; the side yard was skipped.",
          status: "open", answer_by: new Date(now + 23 * 60 * 60_000).toISOString(), answered_at: null, dispute_id: null, created_at: ago(30),
        }],
      };
      break;
    case "continue_day":
      // The Helpr could not finish today; both agreed to come back the day after tomorrow (job_continue_days 'set').
      job = {
        ...base, ...hired, ...today, ...bothIn, status: "in_progress", helper_on_the_way_at: ago(300), helper_arrived_at: ago(280),
        poster_confirmed_arrival_at: ago(278), poster_confirmed_working_at: ago(275),
      };
      applications = [accepted];
      trackingStatus = "in_progress";
      extraTables = {
        job_continue_days: [{
          id: "00000000-0000-4000-d000-000000000002", job_id: jobId, proposed_by: PREVIEW_HELPR_ID, new_date: isoDate(now + 2 * DAY),
          new_start_time: "09:00", note: "Ran out of daylight; the side yard is left.", status: "set", helper_confirmed_at: ago(20),
        }],
      };
      break;
    case "tip": {
      // Approved and paying out, no tip sent yet: the poster's Tip.
      job = {
        ...base, ...hired, ...today, ...bothIn, status: "completed", payment_status: "payout_pending", helper_on_the_way_at: ago(240),
        helper_arrived_at: ago(210), poster_confirmed_arrival_at: ago(208), poster_confirmed_working_at: ago(205),
        helper_completed_at: ago(60), poster_completed_at: ago(30), completed_at: ago(30), payout_scheduled_at: ago(-60 * 24),
      };
      applications = [accepted];
      trackingStatus = "completed";
      break;
    }
    case "recurring":
      // A weekly series (Tuesdays and Thursdays, 4 weeks) with its standing Helpr; this is the next visit.
      job = {
        ...base, ...hired, title: "Mow and edge the lawn", parent_job_id: null, recurrence_days: [2, 4], recurrence_weeks: 4,
        recurrence_interval: "weekly", recurrence_end_date: isoDate(now + 28 * DAY), recurring_helper_id: PREVIEW_HELPR_ID,
      };
      applications = [accepted];
      // The series' visits (the jobs read by parent_job_id): this one, and the next three, all with the same Helpr.
      extraTables = {
        "jobs?parent_job_id": [3, 5, 10, 12].map((d) => ({ date_needed: isoDate(now + d * DAY), status: "accepted", helper_id: PREVIEW_HELPR_ID })),
      };
      break;
    case "late_cancel_poster":
      // The poster cancelled 3 hours before the start: the Helpr keeps the late-cancel fee, the rest is refunded.
      job = {
        ...base, ...hired, date_needed: isoDate(now + DAY), start_time: "09:00", status: "cancelled", payment_status: "refunded",
        cancelled_by: PREVIEW_POSTER_ID, cancelled_at: ago(30), cancellation_reason: "Plans changed", cancellation_fee: 30,
      };
      applications = [{ status: "closed", closed_reason: "job_cancelled", helper_id: PREVIEW_HELPR_ID }];
      break;
    case "late_cancel_helpr":
      // The Helpr cancelled the night before (helper_cancel_booking): the job is back up and they carry a strike.
      job = { ...base, date_needed: isoDate(now + DAY), status: "open" };
      applications = [{ status: "rejected", closed_reason: "helper_cancelled", helper_id: PREVIEW_HELPR_ID }];
      break;
    case "cancel_sheet": {
      // Hired, starting in about 3 hours (inside the 24-hour late-cancel window): the poster's Cancel job opens the fee quote.
      const soon = new Date(now + 3 * 60 * 60_000);
      job = { ...base, ...hired, date_needed: isoDate(soon.getTime()), start_time: `${String(soon.getHours()).padStart(2, "0")}:00` };
      applications = [accepted];
      break;
    }
    case "instant_pending": {
      const until = new Date(now + 95 * 60_000).toISOString();
      job = { ...base, helper_id: PREVIEW_HELPR_ID, status: "accepted", payment_status: "held", direct_offer_status: "pending", instant_decline_until: until };
      applications = [];
      pendingOffer = { id: jobId, instant_decline_until: until };
      offeredTo = PREVIEW_HELPR_ID;
      break;
    }
  }

  const lateFeeCents = stage === "cancel_sheet" && job.helper_id ? Math.round(job.budget * 25) : 0;
  // The poster always reads their own row; a Helpr is a party once offered or hired (or on the crew).
  const party = viewer === "poster" || job.helper_id === PREVIEW_HELPR_ID || crew.includes(PREVIEW_HELPR_ID);
  return {
    stage, viewer, userId, jobId, job, party, applications, trackingStatus, crew, pendingOffer: viewer === "helpr" ? pendingOffer : null,
    offeredTo, candidates,
    // Made-up answers for every other read the page makes (the inert test lists them: adminJobPreviewIsInert).
    reads: {
      // Every rating and count on the page; the backend hands back only the rows asked for (p_user_ids).
      get_public_profile_stats: [
        { user_id: PREVIEW_POSTER_ID, avg_rating: 4.8, review_count: 9, completed_jobs_as_helper: 0, completed_jobs_total: 12, posted_jobs_total: 12, jobs_total: 12, cancelled_jobs: 0, cancellation_rate: 0, on_time_rate: 1, on_time_sample: 0, poster_avg_rating: 4.8, has_pending_credentials: false, has_stripe_account: false, is_background_checked: false, is_id_verified: true },
        { user_id: PREVIEW_HELPR_ID, avg_rating: 4.9, review_count: 11, completed_jobs_as_helper: 14, completed_jobs_total: 14, posted_jobs_total: 0, jobs_total: 15, cancelled_jobs: 1, cancellation_rate: 0.07, on_time_rate: 0.93, on_time_sample: 14, poster_avg_rating: null, has_pending_credentials: false, has_stripe_account: true, is_background_checked: false, is_id_verified: true },
        { user_id: PREVIEW_CREWMATE_ID, avg_rating: 4.8, review_count: 5, completed_jobs_as_helper: 6, completed_jobs_total: 6, posted_jobs_total: 0, jobs_total: 6, cancelled_jobs: 0, cancellation_rate: 0, on_time_rate: 1, on_time_sample: 6, poster_avg_rating: null, has_pending_credentials: false, has_stripe_account: true, is_background_checked: false, is_id_verified: true },
      ],
      // The fee settings (made up: no one-time setup fee, so no take-home line names one).
      get_public_platform_settings: [{ id: "preview", customer_fee_percent: 0, helper_fee_percent: 5, feature_flags: {}, hybrid_idv_enabled: false, idv_auto_approve_threshold: 0, min_supported_build: 0, onboarding_fee_cents: 0 }],
      // null is the RPC's own "not deployed" answer: the caller then makes its older reads, answered from `tables`.
      get_my_activity_cores: null,
      // The Helpr's Working card asks for the job's pets (JobPetCareSheet); the sample job has none.
      get_job_pets: [],
      // Audit 1102e: a read some sheets make ("this would run declutter_my_refund_todos" showed as if an action).
      declutter_my_refund_todos: [],
    },
    tables: {
      job_guarantee_claims: [],
      job_schedule_change_requests: [],
      job_continue_days: [],
      reviews: [],
      tips: [],
      user_violations: [],
      series_visit_holds: [],
      series_date_offers: [],
      recurring_visit_releases: [],
      job_accept_pending: [],
      refund_requests: [],
      ...extraTables,
    },
    // Both sides' cancel sheets: the poster's on the job page, the Helpr's on their Working card.
    opens: stage === "cancel_sheet" ? "Cancel job" : null,
    draws: stage === "cancel_sheet" && viewer === "helpr" ? "helpr_working_card" : "job_page",
    // Inside 24 hours of the start (the Cancel sheet stage) a quarter of the job pays the Helpr for the time held, as
    // the Late cancel by poster stage records (cancellation_fee 30); otherwise nothing is kept.
    cancelQuote: { can_cancel: true, fee_cents: lateFeeCents, fee_percent: lateFeeCents ? 25 : 0, back_to_you_cents: job.budget * 100 - lateFeeCents, charge_state: "hold" },
    actions: {
      poster_cancel_job: { action: lateFeeCents ? "warning" : "none", cancellation_fee: lateFeeCents / 100, had_helper: !!job.helper_id },
      // No action word: "Job cancelled. This counts as a reliability strike." (inside 24 hours); "none" outside them.
      helper_cancel_booking: stage === "cancel_sheet" ? {} : { action: "none" },
    },
    profiles: [
      { id: PREVIEW_POSTER_ID, full_name: "Lexi Landry", avatar_url: null, created_at: "2025-03-14T15:00:00Z" },
      { id: PREVIEW_HELPR_ID, full_name: "Eli Robichaux", avatar_url: null, created_at: "2025-06-02T15:00:00Z" },
      { id: PREVIEW_CREWMATE_ID, full_name: "Maya Thibodeaux", avatar_url: null, created_at: "2025-08-20T15:00:00Z" },
    ],
  };
}
