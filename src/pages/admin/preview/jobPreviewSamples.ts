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
        ...base, ...hired, ...today, ...bothIn, status: "completed", payment_status: "released", helper_on_the_way_at: ago(240),
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
      applications = [{ status: "pending", closed_reason: null, helper_id: PREVIEW_HELPR_ID }];
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
      job = { ...base, ...today, ...bothIn, title: "Move a couch and boxes upstairs", category: "moving", budget: 300, is_group_job: true, helpers_needed: 3, status: "accepted", helper_confirmed_at: ago(60 * 24) };
      applications = [accepted, { status: "accepted", closed_reason: null, helper_id: PREVIEW_CREWMATE_ID }];
      crew = [PREVIEW_HELPR_ID, PREVIEW_CREWMATE_ID];
      break;
    case "instant_pending": {
      const until = new Date(now + 95 * 60_000).toISOString();
      job = { ...base, helper_id: PREVIEW_HELPR_ID, status: "accepted", payment_status: "held", direct_offer_status: "pending", instant_decline_until: until };
      applications = [];
      pendingOffer = { id: jobId, instant_decline_until: until };
      offeredTo = PREVIEW_HELPR_ID;
      break;
    }
  }

  // The poster always reads their own row; a Helpr is a party once offered or hired (or on the crew).
  const party = viewer === "poster" || job.helper_id === PREVIEW_HELPR_ID || crew.includes(PREVIEW_HELPR_ID);
  return {
    stage, viewer, userId, jobId, job, party, applications, trackingStatus, crew, pendingOffer: viewer === "helpr" ? pendingOffer : null,
    offeredTo, candidates,
    profiles: [
      { id: PREVIEW_POSTER_ID, full_name: "Lexi Landry", avatar_url: null, created_at: "2025-03-14T15:00:00Z" },
      { id: PREVIEW_HELPR_ID, full_name: "Eli Robichaux", avatar_url: null, created_at: "2025-06-02T15:00:00Z" },
      { id: PREVIEW_CREWMATE_ID, full_name: "Maya Thibodeaux", avatar_url: null, created_at: "2025-08-20T15:00:00Z" },
    ],
  };
}
