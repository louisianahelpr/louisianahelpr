import { linkTurnoverJob } from "./turnoverPrefill";
import { lifecycleErrorMessage } from "@/lib/lifecycleErrors";
import { identityRefusal, openIdentityCheck } from "@/lib/identityCheck";
import { isUnder18Refusal, UNDER_18_POST_COPY } from "@/lib/ageGate";
import { useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { track, AhaEvent } from "@/lib/analytics";
import { safeStorage } from "@/lib/safeStorage";
import { contactLeakFieldError, contactLeakRejectionMessage } from "@/lib/contactLeakField";
import { TITLE_MAX, DESCRIPTION_MAX } from "@/components/postjob/detailsSection/detailsSectionConstants";
import { report } from "@/lib/errorLogger";
import { backgroundImport } from "@/lib/chunkReload";
import { requireOnline } from "@/lib/requireOnline";
import { assertWritable } from "@/hooks/useImpersonation";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { geocodeAddress, composeJobAddress } from "@/lib/geocode";
import { maybeFireFirstPostConfetti } from "./firstPostConfetti";
import { recordJobActionForPermissionPrompt } from "@/hooks/useNotificationPermissionPrompt";
import { buildJobInsertPayload } from "./jobSubmitHelpers";
import { hasUnfilledPlaceholders } from "@/lib/postingTemplates";
import { isScheduleTooSoon } from "@/lib/jobExpiry";
import { SCHEDULE_TOO_SOON_COPY } from "@/lib/jobScheduleCopy";
import type { Step } from "./postJobFormTypes";
import { materialsNoteForPost, scrollToField } from "./postJobFormHelpers";
import { saveJobAccessNote } from "@/lib/jobAccessNotes";
import {
  MIN_JOB_BUDGET_DOLLARS,
  MAX_JOB_BUDGET_DOLLARS,
  URGENT_FEE_FLOOR_DOLLARS,
  MAX_URGENT_FEE_DOLLARS,
  formatDollarsWhole,
} from "@/lib/moneyLimits";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { requestEscrowCheckout } from "@/lib/escrowCheckout";
import { buildFeeQuote } from "@/lib/jobCheckout";
import { removeJobPhotos } from "@/lib/storageCleanup";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { userFacingError } from "@/lib/userFacingError";
import { CONNECTION_TROUBLE_COPY, isNetworkFailure } from "@/lib/networkFailure";
import { endSentence } from "@/lib/endSentence";
import { NEVER_PAID_STATUSES } from "@/lib/neverPaidStatuses";
import { DRAFT_CHECKOUT_JOB_KEY } from "@/hooks/useDraftJob";
import { LISTED_PAYMENT_STATUSES } from "../../../supabase/functions/_shared/listedPaymentStatus";
import { loadModule } from "@/lib/loadModule";

// Declutter haul-away: loaded only for a haul-away post (off the critical path, Q178).
const haulAwayLib = () => loadModule(() => import("@/lib/declutter/haulAway"));
// The relink sites below run inside try/catch blocks that report and keep the job: a load that came back empty
// during a recovery reload goes the same way as a failed one, never a TypeError.
const haulAwayLibLoaded = async () => {
  const lib = await haulAwayLib();
  if (!lib) throw new Error("haul-away code unavailable: a recovery reload is under way");
  return lib;
};
/** The same, or null when the chunk could not load (the caller then has nothing to undo or word). */
const haulAwayLibOrNull = () => haulAwayLib().catch((err: unknown) => { report(err, { severity: "warning", tags: { source: "useJobSubmit.haulAwayLib" } }); return null; });

/**
 * Remove a job whose payment setup failed, and PROVE it went.
 *
 * `.select("id")` is the whole point. A DELETE that matches zero rows is
 * `{ data: [], error: null }`, so `if (cleanupError) report(...)` was silent
 * about the one outcome that actually matters here: the job row survives. That
 * leaves an orphan in the marketplace with NO escrow behind it — browsable,
 * applicable-to, and impossible to pay out — which is exactly what the cleanup
 * exists to prevent, reported as a success.
 *
 * Answers true when the job is gone (deleted now, or already), false when it
 * was kept (not deletable, unreadable, or the DELETE refused): a caller clears
 * its attempt and puts haul-away items back only on true (lh-money-escrow
 * review of bf3cd5730 #5: a kept job with a live checkout must stay this
 * attempt's job, or the next tap posts a second one).
 *
 * Deliberately never throws: both call sites are already on an error path
 * (payment setup failed) that owns the user-facing toast and the step reset.
 * A failed cleanup must be loud in monitoring, not a second exception thrown
 * over the first one.
 */
async function cleanupOrphanJob(jobId: string, opts: { keptIsExpected?: boolean } = {}): Promise<boolean> {
  // Q?gift-paid-retry-photos: confirm the job is one its poster may delete
  // BEFORE touching its photos. A job whose payment answer was lost may be
  // funded by now (a gift card settles inside create-payment) or hold a live
  // checkout; the DELETE below is then refused, and removing the photos first
  // left a paid job with none. The rule is the poster's DELETE policy
  // (20260903055308): open, and unpaid with no checkout session, or abandoned.
  // An unreadable job is kept whole (fail safe: an unpaid job is never shown
  // in Posts, a funded one keeps its photos).
  try {
    const { data: row, error: readErr } = await supabase
      .from("jobs")
      .select("status, payment_status, stripe_session_id")
      .eq("id", jobId)
      .maybeSingle();
    if (readErr) {
      report(readErr, { tags: { source: "PostJob.orphanCleanup", kind: "read_failed" }, context: { job_id: jobId } });
      return false;
    }
    if (!row) return true; // already gone: nothing to remove, and its photos are the storage sweep's
    const pay = row.payment_status ?? "unpaid";
    const deletable = row.status === "open" && ((pay === "unpaid" && row.stripe_session_id == null) || pay === "abandoned");
    if (!deletable) {
      // A kept draft's earlier job whose checkout is still live (F25): keeping it is the expected
      // answer there, not an incident; that checkout expires within the hour (Q770).
      if (opts.keptIsExpected) return false;
      report(new Error("Orphan job cleanup skipped: the job is funded or has a live checkout, so it is kept with its photos"), {
        severity: "warning",
        tags: { source: "PostJob.orphanCleanup", kind: "kept_not_deletable" },
        context: { job_id: jobId, status: row.status, payment_status: pay, has_session: row.stripe_session_id != null },
      });
      return false;
    }
  } catch (err) {
    report(err, { tags: { source: "PostJob.orphanCleanup", kind: "read_failed" }, context: { job_id: jobId } });
    return false;
  }
  // The photos and scope video were uploaded before checkout. Remove them
  // now, before the delete: the job-photos DELETE policy needs the job row to
  // exist, and after the delete nothing names them. Never throws or blocks
  // (reported inside).
  await removeJobPhotos(jobId, "PostJob.orphanCleanup");
  try {
    const { data, error } = await supabase.from("jobs").delete().eq("id", jobId).select("id");
    if (error) {
      report(error, { tags: { source: "PostJob.orphanCleanup" }, context: { job_id: jobId } });
      return false;
    }
    if (!data || data.length === 0) {
      report(new Error("Orphan job cleanup deleted 0 rows — unfunded job may be live"), {
        severity: "error",
        tags: { source: "PostJob.orphanCleanup", kind: "mutation_rejected" },
        context: { job_id: jobId, rowsAffected: data?.length ?? 0 },
      });
      return false;
    }
    return true;
  } catch (err) {
    report(err, { tags: { source: "PostJob.orphanCleanup" }, context: { job_id: jobId } });
    return false;
  }
}

/**
 * The payment states in which a job's money is held for it: the same set as
 * PaymentSuccess.tsx's HELD_STATUSES (lh-silent-failure review of bf3cd5730
 * #1: 'cancelled', 'refunded' and 'chargeback' are closed, never "paid").
 */
// Q2399: a held card counts (the post went through; never clean it up).
const FUNDED_STATUSES = LISTED_PAYMENT_STATUSES;

/**
 * Q?gift-paid-retry-photos: whether this attempt's own job holds money now.
 * true = funded (FUNDED_STATUSES), false = anything else or gone (the cleanup
 * still checks the job is deletable before touching it), null = the read
 * failed (the caller must not clean up).
 */
async function jobIsFunded(jobId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.from("jobs").select("payment_status").eq("id", jobId).maybeSingle();
    if (error) {
      report(error, { tags: { source: "PostJob.fundedCheck" }, context: { job_id: jobId } });
      return null;
    }
    if (!data) return false;
    return (FUNDED_STATUSES as readonly string[]).includes(data.payment_status ?? "unpaid");
  } catch (err) {
    report(err, { tags: { source: "PostJob.fundedCheck" }, context: { job_id: jobId } });
    return null;
  }
}

/**
 * Rentals: point the approved maintenance request at the job just posted from
 * it. Best effort: the job exists either way, but the landlord is told when
 * the link fails or is refused (lh-authz-rls review of ca8e149b9 #10), because
 * an unlinked job never shows on the tenant's request and the tenant cannot
 * answer "Was it fixed?" for it.
 *
 * "stop" when the request already points at another live job (paid, mid-
 * checkout, or posted and still payable: another tab or device got there
 * first): paying for this one would pay for the same repair twice
 * (lh-money-escrow reviews of 01f8eab54 #2 and bb5b8bc6e #3). The request is
 * re-read after a refusal AND after a link call that failed (network, timeout,
 * deadlock), since a failed call says nothing about the request. A re-read
 * that cannot be made (the chunk did not load, or the read failed) also stops:
 * the money-safe answer to "is it already paid?" is not to pay again. A re-read
 * showing the request already on THIS job (the link landed, its answer was
 * lost) goes on with nothing to tell.
 */
async function linkMaintenanceJobOrTell(requestId: string, jobId: string): Promise<"go" | "stop"> {
  let linkErr: unknown;
  let mod: typeof import("./maintenancePrefill") | null = null;
  try {
    // Loaded only for a post opened from a request (off /posts' shared chunk);
    // a background import, so a stale chunk never reloads the page mid-submit.
    // A chunk that cannot load is a failed link, told below.
    mod = await backgroundImport(() => import("./maintenancePrefill"), "maintenance-prefill");
    if (await mod.linkMaintenanceJob(requestId, jobId)) return "go";
    linkErr = new Error("maintenance link refused");
  } catch (err) {
    linkErr = err;
  }
  report(linkErr, { severity: "warning", tags: { source: "useJobSubmit.linkMaintenance" }, context: { job_id: jobId, request_id: requestId } });
  if (!mod) return "stop";
  const now = await mod.fetchMaintenancePrefill(requestId).catch((readErr: unknown) => {
    report(readErr, { severity: "warning", tags: { source: "useJobSubmit.linkMaintenanceRecheck" }, context: { request_id: requestId } });
    return undefined;
  });
  if (now === undefined) return "stop";
  if (now?.linkedJobId === jobId) return "go";
  if (now?.alreadyPosted) return "stop";
  // A failed CALL on a request that is still free: try the link once more, so a
  // dropped call does not leave the repair offering a second post (re-review nit 3).
  if (now && (linkErr as Error).message !== "maintenance link refused") {
    const again = await mod.linkMaintenanceJob(requestId, jobId).catch(() => false);
    if (again) return "go";
  }
  toast.error("Your job posted, but it isn't linked to the repair request", {
    description: "Your tenant won't see it on their request. Tell them once a Helpr is booked.",
  });
  return "go";
}

/**
 * Declutter "Add a Helpr": point the paid order at this job, so the order card
 * shows the Helpr booked. Best effort: the job exists either way, but the
 * buyer is told when the link fails (lh-silent-failure review #1), so a
 * missing line on the order card never reads as "nothing booked yet".
 */
async function linkSetupJobOrTell(orderId: string, jobId: string): Promise<void> {
  let linkErr: unknown = null;
  try {
    // Loaded only for an "Add a Helpr" post (off /posts' shared chunk, Q178);
    // a chunk that cannot load is a failed link, told to the buyer below. As a
    // background import, so a stale chunk never starts the recovery reload
    // mid-submit, between the job row and the checkout redirect (lh-money-escrow
    // review of 6ef39799d #3a).
    const { linkSetupJob } = await backgroundImport(() => import("@/lib/declutter/setupHelpr"), "declutter-setup-helpr");
    if (!(await linkSetupJob(orderId, jobId))) linkErr = new Error("declutter setup job not linked");
  } catch (err) {
    linkErr = err;
  }
  if (!linkErr) return;
  report(linkErr, { severity: "warning", tags: { source: "useJobSubmit.linkDeclutterSetup" }, context: { job_id: jobId } });
  // A refusal the server explains (banned, switch off, already paid)
  // carries its words in userMessage (setupHelpr.ts, RPC_ERROR_COPY).
  const why = (linkErr as { userMessage?: string } | null)?.userMessage;
  toast.error("Your job posted, but it isn't showing on your Declutter purchase", {
    description: why ?? "Find it under your posted jobs.",
  });
}

/**
 * The job a post attempt created, found by its idempotency key (Q267), or null.
 * Used when the key's unique index refuses a retry (the first INSERT landed and
 * its response was lost) and when an edited form abandons an earlier attempt.
 * A failed read is reported and answers null: the caller then treats the
 * attempt as not landed, which at worst is the pre-Q267 behaviour.
 */
async function findJobByKey(userId: string, key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id")
    .eq("customer_id", userId)
    .eq("client_request_id", key)
    .maybeSingle();
  if (error) {
    report(error, { tags: { source: "PostJob.findJobByKey" } });
    return null;
  }
  return data?.id ?? null;
}

/**
 * useJobSubmit — owns the review-gate, pre-submit checks, and the full
 * job-insert → payment-redirect flow. Pure structural extraction from
 * usePostJobForm: every Supabase call, error check, `report()`, and money
 * calculation is unchanged and runs in the same order.
 *
 * All form state, setters, and media-upload callbacks are passed in via a
 * single params object so the parent hook remains the single source of
 * truth — this hook only reads that state and drives the submit behavior.
 */
export interface UseJobSubmitParams {
  // Overlay / status setters (parent-owned)
  saving: boolean;
  setSaving: (v: boolean) => void;
  setRedirecting: (v: boolean) => void;
  setStep: (s: Step) => void;
  setConfirmed: (v: boolean) => void;
  // Draft
  flushDraft: () => void;
  // Details fields
  title: string;
  description: string;
  category: string;
  /** Pet profile ids to attach after the insert (pet-care jobs). */
  selectedPetIds?: string[];
  // Logistics fields
  streetAddress: string;
  city: string;
  addrState: string;
  zipCode: string;
  parish: string | null;
  dateNeeded: string;
  startTime: string;
  isFlexibleSchedule: boolean;
  estimatedHours: string;
  // Budget fields
  budget: string;
  specialRequirements: string;
  isRecurring: boolean;
  recurrenceInterval: string;
  recurrenceEndDate: string;
  recurrenceDays: number[];
  recurrenceWeeks: number;
  /** Q407 (4): the poster is OK with different Helprs on different dates. */
  seriesSplitOk?: boolean;
  isGroupJob: boolean;
  helpersNeeded: string;
  isUrgent: boolean;
  urgentFee: string;
  salesTaxRate: number;
  offerToHelperId: string | null;
  offerResponseHours: number;
  credentialTier: number;
  /** Poster's per-job before/after photo-proof requirement. */
  requirePhotoProof: boolean;
  // Materials + card
  includeMaterials: boolean;
  materialsNote: string;
  saveCardForFuture: boolean;
  // Gift card — when the poster arrived from a gift redemption, the
  // credit id rides through checkout so create-payment settles it (fully
  // covered → funds from prepaid balance, $0 charge; partial → collect the
  // difference via Stripe). Null for an ordinary post.
  giftCardId: string | null;
  /** Q768: the imported STR turnover this post was opened from (`?turnover=`), linked to the new job. */
  turnoverId?: string | null;
  /** Declutter haul-away: the seller's items this post hauls away (`?haulAway=`), linked to the new job. */
  haulAwayItemIds?: string[] | null;
  /** Declutter "Add a Helpr": the paid order this post was opened from (`?declutterOrder=`), linked to the new job. */
  declutterOrderId?: string | null;
  /** Rentals S1: the approved maintenance request this post was opened from (`?maintenance=`), linked to the new job. */
  maintenanceRequestId?: string | null;
  // Media upload callbacks
  uploadAndAttachPhotos: (jobId: string) => Promise<void>;
  uploadAndAttachScopeVideo: (jobId: string) => Promise<void>;
  /** jobs_poster_fee is on for this poster (owner 2026-10-18); absent = off. */
  posterFeeOn?: boolean;
}

export function useJobSubmit(params: UseJobSubmitParams) {
  const {
    saving,
    setSaving,
    setRedirecting,
    setStep,
    setConfirmed,
    flushDraft,
    title,
    description,
    category,
    selectedPetIds,
    streetAddress,
    city,
    addrState,
    zipCode,
    parish,
    dateNeeded,
    startTime,
    isFlexibleSchedule,
    estimatedHours,
    budget,
    specialRequirements,
    isRecurring,
    recurrenceInterval,
    recurrenceEndDate,
    recurrenceDays,
    recurrenceWeeks,
    seriesSplitOk,
    isGroupJob,
    helpersNeeded,
    isUrgent,
    urgentFee,
    salesTaxRate,
    offerToHelperId,
    offerResponseHours,
    credentialTier,
    requirePhotoProof,
    includeMaterials,
    materialsNote: materialsNoteInput,
    saveCardForFuture,
    giftCardId,
    turnoverId,
    haulAwayItemIds,
    declutterOrderId,
    maintenanceRequestId,
    uploadAndAttachPhotos,
    uploadAndAttachScopeVideo,
  } = params;
  // The jobs_poster_fee switch as the checkout screen read it (usePostJobForm
  // reads it once for both hooks): the quote below must say what it showed.
  const posterFeeOn = params.posterFeeOn === true;

  /** `quotes`: Review opened from Get quotes (A2-C32): no price yet, so the budget checks do not apply. */
  const handleReview = (e: React.FormEvent, opts: { quotes?: boolean } = {}) => {
    e.preventDefault();
    if (!title.trim()) { toast.error("Give your job a title."); scrollToField("title"); return; }
    // Upper bound too, not just presence. `maxLength` on the input guards
    // typing but not a prefill, and Repost (`?rebook=`) hands this form the
    // previous job's title verbatim — prod still holds titles up to 45 chars
    // from before TITLE_MAX existed. Without this the form happily carried an
    // over-length title to checkout while the field counter read "45/32".
    if (title.length > TITLE_MAX) {
      toast.error(`Shorten your title to ${TITLE_MAX} characters — it's ${title.length - TITLE_MAX} too long.`);
      scrollToField("title");
      return;
    }
    // Contact details in a post are REJECTED by the database (23514, see
    // contactLeakField.ts); the fields already show the inline error, so
    // block here with the same sentence instead of at checkout.
    {
      const titleLeak = contactLeakFieldError(title, "job title");
      if (titleLeak) { toast.error(titleLeak); scrollToField("title"); return; }
    }
    if (!description.trim()) { toast.error("Add a description."); scrollToField("description"); return; }
    // Same reason as the title: a prefill can pass the textarea's maxLength,
    // and the DB refuses over DESCRIPTION_MAX (jobs_description_length, Q782).
    if (description.length > DESCRIPTION_MAX) {
      toast.error(`Shorten your description to ${DESCRIPTION_MAX} characters — it's ${description.length - DESCRIPTION_MAX} too long.`);
      scrollToField("description");
      return;
    }
    {
      const descLeak = contactLeakFieldError(description, "job description");
      if (descLeak) { toast.error(descLeak); scrollToField("description"); return; }
    }
    if (hasUnfilledPlaceholders(description)) { toast.error("Replace the [bracketed] placeholders with your own details before posting."); scrollToField("description"); return; }
    if (!category) { toast.error("Pick a category."); scrollToField("category-picker"); return; }
    // Photo is optional — a photo dramatically improves applicant count and
    // quote accuracy, so it's strongly nudged in the UI, but tasks like
    // dog-walking or errands have no natural photo and shouldn't be blocked.
    if (!streetAddress.trim()) { toast.error("Add a street address."); scrollToField("streetAddress"); return; }
    if (!city.trim()) { toast.error("Add a city."); scrollToField("city"); return; }
    if (!addrState.trim()) { toast.error("Add a state."); scrollToField("state"); return; }
    if (!zipCode.trim()) { toast.error("Add a zip code."); scrollToField("zipCode"); return; }
    if (!dateNeeded) { toast.error("Pick a date for the job."); scrollToField("date"); return; }
    // Validate date is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = new Date(dateNeeded + "T00:00:00");
    if (selectedDate < today) { toast.error("That date has already passed — pick a future date."); scrollToField("date"); return; }
    if (!isFlexibleSchedule && !startTime) { toast.error("Start time is required (or mark the schedule as flexible)."); scrollToField("flexible"); return; }
    // The date check above is midnight-to-midnight, so TODAY at a time that
    // has already gone by used to sail through — and the listing expiry is
    // derived from exactly that instant, so the job was created already
    // expired and invisible to every helper the moment the poster paid.
    // Refuse it here rather than silently shifting their time, so they fix it
    // BEFORE checkout. (jobExpiry's floor and trg_job_expiry_floor still catch
    // any path that gets past this.)
    if (isScheduleTooSoon(dateNeeded, startTime)) {
      toast.error(SCHEDULE_TOO_SOON_COPY);
      // The START TIME, not the date. When the poster picked today, the date
      // is correct and the time is the thing that is wrong — scrolling to the
      // date field pointed at the one field they had no reason to change.
      // (The same condition also paints an inline error here and disables the
      // CTA, so this handler is now the backstop rather than the only signal.)
      scrollToField("start-time");
      return;
    }
    // The Access & Parking notes are optional — no validation needed
    // The budget is always required and always bounded now. It used to be
    // skipped entirely in "Accept bids" mode, which is how a bid job reached
    // checkout carrying a stale hidden budget and got charged for it.
    if (opts.quotes) { setStep("checkout"); return; }
    if (!budget || parseFloat(budget) < MIN_JOB_BUDGET_DOLLARS) { toast.error(`Minimum budget is ${formatDollarsWhole(MIN_JOB_BUDGET_DOLLARS)}.`); scrollToField("budget"); return; }
    if (parseFloat(budget) > MAX_JOB_BUDGET_DOLLARS) { toast.error(`Maximum budget is ${formatDollarsWhole(MAX_JOB_BUDGET_DOLLARS)}.`); scrollToField("budget"); return; }
    if (isUrgent && (parseFloat(urgentFee) < URGENT_FEE_FLOOR_DOLLARS || isNaN(parseFloat(urgentFee)))) { toast.error(`Urgent bonus must be at least ${formatDollarsWhole(URGENT_FEE_FLOOR_DOLLARS)}.`); scrollToField("custom-urgent-fee"); return; }
    // The bonus had a floor but no CEILING, while the budget it rides on is
    // capped at $5,000. $99,999 in this field on a $100 job reached a live
    // Stripe checkout for $103,088.88 with Pay enabled.
    if (isUrgent && parseFloat(urgentFee) > MAX_URGENT_FEE_DOLLARS) { toast.error(`Urgent bonus can't be more than ${formatDollarsWhole(MAX_URGENT_FEE_DOLLARS)}.`); scrollToField("custom-urgent-fee"); return; }
    // A series with no days is not a series. The picker seeds the job's own
    // weekday so this should be unreachable from a fresh form, but a restored
    // draft predating the day set would come back empty — and letting it
    // through would create a parent that never spawns a second visit and never
    // says why.
    if (isRecurring && recurrenceDays.length === 0) {
      toast.error("Pick at least one day this job repeats on.");
      scrollToField("date");
      return;
    }
    setConfirmed(false);
    setStep("checkout");
  };

  const submittingRef = useRef(false);
  /**
   * Q267 — ONE post attempt, however many times the poster presses.
   *
   * `key` is sent as jobs.client_request_id and is UNIQUE per poster
   * (20260923181707), so a retry whose first INSERT landed but whose response
   * was lost is refused with 23505 and resolved to the row that exists.
   * `jobId` is set once this attempt's job is known to exist; a retry then
   * skips the INSERT and only re-runs the payment hand-off for THAT job
   * (create-payment retires the previous Checkout Session before minting
   * another). `sig` is the payload the key was minted for: if the poster edits
   * the job between presses it is a new attempt, and the old one's job, if it
   * landed, is cleaned up rather than left behind.
   */
  const attemptRef = useRef<{ key: string; sig: string; jobId: string | null } | null>(null);
  const COOLDOWN_KEY = "helpr_last_job_submit";
  const COOLDOWN_MS = 30_000; // 30 second cooldown

  /**
   * Pre-flight gating before any job INSERT — double-click guard, submit
   * cooldown, auth and the open-job limit. Identity verification gates nothing
   * (owner, 2026-10-01; migration 20261001222911_remove_idv_requirement).
   *
   * Returns the authenticated `user` when all checks pass, or `null` when
   * a check failed (in which case it has already shown the right toast /
   * dialog and reset `saving` + `submittingRef`). Behavior is identical to
   * the inline checks it replaces — same order, same messages.
   */
  const runPreSubmitChecks = async () => {
    // Prevent double-click
    if (submittingRef.current || saving) return null;
    // Read-only impersonation: admins viewing as another user cannot post.
    if (!assertWritable()) return null;

    // Cooldown check
    const lastSubmit = safeStorage.getItem(COOLDOWN_KEY);
    if (lastSubmit && Date.now() - parseInt(lastSubmit) < COOLDOWN_MS) {
      toast.error("Please wait before posting another job. You recently submitted one.");
      return null;
    }

    submittingRef.current = true;
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Sign in to post a job.");
      setSaving(false);
      submittingRef.current = false;
      return null;
    }

    // Check open job limit (server enforces too, but show friendly message).
    // The payment_status filter mirrors enforce_open_job_limit exactly: a job
    // that was never paid for (NEVER_PAID_STATUSES: 'unpaid', 'abandoned',
    // 'failed') is invisible in every browse surface and in the poster's own
    // Posts, and holds no slot in the trigger. Drift here would show a friendly
    // "you're at 5" toast for a post the server would happily accept. This
    // used to exclude only 'abandoned', then skipped 'failed' until 2026-09-27.
    const { count: openCount, error: openCountErr } = await supabase.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", user.id).eq("status", "open").not("payment_status", "in", `(${NEVER_PAID_STATUSES.join(",")})`);
    if (openCountErr) {
      report(openCountErr, { tags: { source: "usePostJobForm.openJobLimit" } });
      toast.error("Couldn't check your open job count — please try again.");
      setSaving(false);
      submittingRef.current = false;
      return null;
    }
    if ((openCount ?? 0) >= 5) {
      toast.error("You can have a maximum of 5 open jobs at a time. Close or wait for existing jobs first.");
      setSaving(false);
      submittingRef.current = false;
      return null;
    }

    return user;
  };

  const handleSubmit = async () => {
    if (!requireOnline()) return;
    const user = await runPreSubmitChecks();
    if (!user) return;

    // Q1461: the two notes are stored apart. Materials is public and rides on
    // the job row; Access & Parking (the `specialRequirements` field) is
    // private to the booked Helpr and is written to job_access_notes after
    // the insert, below.
    const materialsNote = materialsNoteForPost({ includeMaterials, materialsNote: materialsNoteInput });
    const accessNotes = specialRequirements.trim();

    const buildPayload = (opts: { withExtras: boolean }) =>
      buildJobInsertPayload({
        userId: user.id,
        // Always NULL. There are no business accounts: `businesses` and
        // `business_members` were dropped in migration 20260828011811, and the
        // jobs INSERT policy now requires `business_id IS NULL`. The column is
        // kept (AdminExport still exports it), so the field stays on the
        // payload type — it just has no non-null source. Same story for
        // `department` below.
        businessId: null,
        title,
        description,
        category,
        streetAddress,
        city,
        addrState,
        zipCode,
        parish,
        dateNeeded,
        startTime,
        isFlexibleSchedule,
        estimatedHours,
        budget,
        // Stripped on the deploy-lag retry, like credentialTier: that retry
        // exists for a prod that predates the column.
        materialsNote: opts.withExtras ? materialsNote : null,
        isRecurring,
        recurrenceInterval,
        recurrenceEndDate,
        recurrenceDays,
        recurrenceWeeks,
        seriesSplitOk,
        isGroupJob,
        helpersNeeded,
        isUrgent,
        urgentFee,
        salesTaxRate,
        offerToHelperId,
        offerResponseHours,
        credentialTier: opts.withExtras ? credentialTier : 0,
        // Stripped on the retry path for the same reason credentialTier is:
        // that retry exists for a prod that predates the column, and sending
        // an unknown column would fail the INSERT a second time. `true` is the
        // column default, so the deploy-lag window loses an opt-OUT only.
        requirePhotoProof: opts.withExtras ? requirePhotoProof : true,
        department: null,
      });

    // `expires_at` is left out: it is floored to now + 1 hour, so for a job
    // starting within the hour it differs on every press, and a retry would
    // read as an edit and post a second job.
    const { expires_at: _expiresAt, ...sigFields } = buildPayload({ withExtras: true });
    void _expiresAt;
    // The access notes are not on the payload, but they are part of what was
    // posted: editing them between attempts is an edit.
    const sig = JSON.stringify({ ...sigFields, accessNotes });
    const prior = attemptRef.current;
    if (prior && prior.sig !== sig) {
      // Edited since an attempt whose outcome we never heard. If that attempt's
      // job exists, it holds the OLD details: remove it (best-effort; a job
      // that cannot be deleted stays an unpaid draft in Post a Job) and start
      // a new attempt, rather than paying for the stale one.
      const staleId = prior.jobId ?? (await findJobByKey(user.id, prior.key));
      if (staleId) await cleanupOrphanJob(staleId);
      attemptRef.current = null;
    }
    if (!attemptRef.current) {
      // F25 (audit 2026-10-28, lead decision): a poster who backed out of checkout and picked the
      // draft up again posts the edited job FRESH; the old row is never reused. The job the kept
      // draft was last sent to checkout for (Q769) was never paid, so it is removed rather than
      // left as a second job. cleanupOrphanJob keeps one that is funded or still has a live
      // checkout (it may be paid at any moment, and the poster's DELETE policy refuses it too);
      // that one stays until its checkout expires, and an unpaid job is never shown in Posts.
      const priorDraftJob = safeStorage.getItem(DRAFT_CHECKOUT_JOB_KEY);
      if (priorDraftJob && (await cleanupOrphanJob(priorDraftJob, { keptIsExpected: true }))) {
        safeStorage.removeItem(DRAFT_CHECKOUT_JOB_KEY);
      }
      attemptRef.current = { key: crypto.randomUUID(), sig, jobId: null };
    }
    const attempt = attemptRef.current;

    if (attempt.jobId) {
      // This attempt's job already exists; only its payment hand-off failed,
      // and on the wire, so we never heard whether it worked. Pay for THAT
      // job; posting again would create a second one.
      // A Declutter haul-away links again first (a no-op while it is still
      // linked): if the seller put the items back on sale or booked them on
      // another job meanwhile, this job must not be paid for them.
      if (haulAwayItemIds && haulAwayItemIds.length > 0) {
        try {
          await (await haulAwayLibLoaded()).linkHaulAwayForJob(haulAwayItemIds, attempt.jobId);
        } catch (linkErr) {
          report(linkErr, { severity: "warning", tags: { source: "useJobSubmit.relinkHaulAway" }, context: { job_id: attempt.jobId } });
          // Never clean up a job that may hold money: this job's payment
          // hand-off was lost, so a gift card may have funded it inside
          // create-payment (re-review 2026-10-17, finding 1). The server
          // answers success when the items are still linked to it; a refusal
          // means they moved on, so nothing is paid for them here. A FUNDED
          // job (or one that cannot be read) stays as it is, in Posts, and
          // attemptRef keeps naming it, so a further press never posts a
          // second job. A job read as never paid is removed and its items put
          // back, as on the first post (lh-silent-failure review of bf3cd5730
          // #2: else every press re-links and is refused again);
          // cleanupOrphanJob itself refuses a job that is not deletable.
          const funded = isNetworkFailure(linkErr) ? null : await jobIsFunded(attempt.jobId);
          if (funded === false && (await cleanupOrphanJob(attempt.jobId))) {
            const undo = await haulAwayLibOrNull();
            if (undo) await undo.undoHaulAwayForJob(haulAwayItemIds, attempt.jobId);
            attemptRef.current = null;
            safeStorage.removeItem(COOLDOWN_KEY);
          }
          hapticError();
          const haul = await haulAwayLibOrNull();
          toast.error(`Couldn't book the haul-away: ${haul ? haul.haulAwayErrorMessage(linkErr) : CONNECTION_TROUBLE_COPY}`);
          setSaving(false);
          setStep("checkout");
          setConfirmed(false);
          submittingRef.current = false;
          return;
        }
      }
      // Declutter "Add a Helpr": link again first (lh-money-escrow review of
      // 4f45a073f #4: the first link's answer may have been lost too, and a
      // paid setup job must never be left off its order card). The server
      // answers yes when the job is already linked to this order, whatever
      // the job's payment state since; best effort, as on the first post.
      if (declutterOrderId) await linkSetupJobOrTell(declutterOrderId, attempt.jobId);
      safeStorage.setItem(COOLDOWN_KEY, Date.now().toString());
      await startPayment(attempt.jobId, Promise.resolve());
      return;
    }

    // `withExtras: false` is the deploy-lag retry below; it drops the key too,
    // so a prod that predates jobs.client_request_id still takes the post.
    const insertJob = (withExtras: boolean) =>
      supabase
        .from("jobs")
        .insert({
          ...buildPayload({ withExtras }),
          ...(withExtras ? { client_request_id: attempt.key } : {}),
        })
        .select("id")
        .single();

    let { data: jobData, error } = await insertJob(true);

    // The retry of an INSERT that already landed (its response was lost): the
    // key's unique index refuses the copy. The existing row IS this post.
    if (error && (error as { code?: string }).code === "23505") {
      const existingId = await findJobByKey(user.id, attempt.key);
      if (existingId) {
        jobData = { id: existingId };
        error = null;
      }
    }

    if (error) {
      // A column this payload opts into may not exist on prod yet (migration
      // unapplied). `withExtras: false` is what the retry actually strips:
      // jobs.credential_tier (migration 20260612150000). Strip it and retry so
      // the post still lands.
      //
      // This used to also cover a `status = 'pending_approval'` write — hence
      // 22P02 (invalid_text_representation), which fired when the job_status
      // enum on an old prod lacked that label. Nothing writes `status` from the
      // post flow any more (see jobSubmitHelpers), so 22P02 is no longer
      // reachable from that cause; it is kept only because retrying on it is
      // harmless and a future enum-valued field would want it.
      const code = (error as { code?: string }).code;
      const missingNew = code === "PGRST204" || code === "42703" || code === "22P02";
      if (missingNew) {
        const retry = await insertJob(false);
        jobData = retry.data;
        error = retry.error;
      }
    }

    // Stripe Identity before a post (20261021081258): open the one ID sheet,
    // not an error toast. Nothing was written; the form keeps every field.
    // If the sheet cannot open (ID check off on this device), fall through to the error below.
    if (error && identityRefusal(error) === "post" && openIdentityCheck("post")) {
      setSaving(false);
      submittingRef.current = false;
      return;
    }

    if (error || !jobData) {
      // Never toast a raw PostgREST message. `error.message` on an RLS refusal
      // is literally "new row violates row-level security policy for table
      // jobs", which tells a poster nothing they can act on and reads like the
      // app is broken. 42501 here means a server-side gate the client thought
      // it had already cleared (ownership, a business_id, or a blocked offer
      // target), so say so in words a poster can act on.
      // A contact-leak rejection is the ONE server message shown verbatim:
      // the trigger writes it for the user and names the field.
      const isPolicyRefusal = (error as { code?: string } | null)?.code === "42501";
      const leakRejection = contactLeakRejectionMessage(error);
      toast.error(
        leakRejection
          ? leakRejection
          // Q2291: the server's Louisiana-only address rule, in its own words.
          : /job_address_not_louisiana/.test((error as { message?: string } | null)?.message ?? "")
            ? (lifecycleErrorMessage(error) ?? "Helpr is in Louisiana only for now. Use a Louisiana address.")
          // Q1586(c): the server's under-18 refusal (also 42501) in its own words.
          : isUnder18Refusal(error)
            ? UNDER_18_POST_COPY
          : isPolicyRefusal
            ? "We couldn't post this job from your account. Refresh the page and try again."
            // Q270: never the raw text. A dropped connection gets connection
            // copy (and the attempt's key is kept, so the retry is safe);
            // anything else goes through the shared internal-text filter.
            : isNetworkFailure(error)
              ? CONNECTION_TROUBLE_COPY
              : userFacingError(error, "Couldn't post your job just yet — give it another try?"),
      );
      setSaving(false);
      submittingRef.current = false;
      return;
    }

    // Set cooldown timestamp immediately after successful insert
    safeStorage.setItem(COOLDOWN_KEY, Date.now().toString());
    attempt.jobId = jobData.id;

    /* ACCESS & PARKING (Q1461) — private to the booked Helpr, so it is not on
       the job row. Written like the pets below: the job exists and is paid
       for either way, so a failure here never fails the post; it is reported
       and the poster is told where to add it again. */
    if (accessNotes) {
      try {
        await saveJobAccessNote(jobData.id, accessNotes);
      } catch (accessErr) {
        report(accessErr, {
          tags: { source: "useJobSubmit.saveAccessNotes" },
          context: { job_id: jobData.id },
        });
        const leak = contactLeakRejectionMessage(accessErr);
        toast.error("Your job posted, but the access and parking notes didn't save", {
          description: leak ?? "Open the job and add them from Edit so your Helpr can see them.",
        });
      }
    }

    /* PETS — attach the profiles the poster picked (migration 20260823160000).
       Best-effort and non-blocking: the job exists and is paid for either way,
       and failing the whole post because a care sheet did not link would be a
       far worse outcome than a poster re-attaching from Edit. Reported so a
       systematic failure is visible rather than silent. */
    if (selectedPetIds && selectedPetIds.length > 0) {
      const { error: petErr } = await supabase
        .from("job_pets" as never)
        .insert(
          selectedPetIds.map((petId) => ({ job_id: jobData.id, pet_id: petId })) as never,
        );
      if (petErr) {
        report(petErr, {
          tags: { source: "useJobSubmit.attachPets" },
          context: { job_id: jobData.id, pet_count: selectedPetIds.length },
        });
        toast.error("Your job posted, but the pet details didn't attach", {
          description: "Open the job and add them from Edit so your Helpr can see them.",
        });
      }
    }

    /* Q768: point the imported STR turnover at this job, so its notice never
       offers the same checkout again. Best effort: the job exists either way. */
    if (turnoverId) {
      try {
        await linkTurnoverJob(turnoverId, jobData.id);
      } catch (linkErr) {
        report(linkErr, { severity: "warning", tags: { source: "useJobSubmit.linkTurnover" }, context: { job_id: jobData.id } });
      }
    }

    /* Declutter haul-away (docs/specs/declutter-haul-away.md): link the items
       to this job and take them off sale BEFORE payment, so nobody buys an
       item a Helpr is about to haul. NOT best effort: if the server refuses
       (a buyer got one meanwhile, or a Helpr is already booked), paying for
       this job would haul the wrong thing, so the unpaid job is removed, any
       item the link did take off sale is put back, and the seller is told why. */
    if (haulAwayItemIds && haulAwayItemIds.length > 0) {
      try {
        await (await haulAwayLibLoaded()).linkHaulAwayForJob(haulAwayItemIds, jobData.id);
      } catch (linkErr) {
        report(linkErr, { severity: "warning", tags: { source: "useJobSubmit.linkHaulAway" }, context: { job_id: jobData.id } });
        await cleanupOrphanJob(jobData.id);
        const haul = await haulAwayLibOrNull();
        if (haul) await haul.undoHaulAwayForJob(haulAwayItemIds, jobData.id);
        attemptRef.current = null;
        safeStorage.removeItem(COOLDOWN_KEY);
        hapticError();
        toast.error(`Couldn't book the haul-away: ${haul ? haul.haulAwayErrorMessage(linkErr) : CONNECTION_TROUBLE_COPY}`);
        setSaving(false);
        setRedirecting(false);
        setStep("checkout");
        setConfirmed(false);
        submittingRef.current = false;
        return;
      }
    }
    /* Declutter "Add a Helpr": point the paid order at this job, so the order
       card shows the Helpr booked. Best effort: the job exists either way, but
       the buyer is told when the link fails (lh-silent-failure review #1), so a
       missing line on the order card never reads as "nothing booked yet". */
    if (declutterOrderId) await linkSetupJobOrTell(declutterOrderId, jobData.id);
    /* Rentals S1: point the maintenance request at this job (best effort, the
       turnover rule): the tenant then sees it booked and can answer "Was it fixed?".
       A failed or refused link is reported AND told to the landlord. */
    if (maintenanceRequestId && (await linkMaintenanceJobOrTell(maintenanceRequestId, jobData.id)) === "stop") {
      // The repair already has a paid (or paying) job: remove this unpaid one
      // and stop before payment, like a refused haul-away link.
      await cleanupOrphanJob(jobData.id);
      attemptRef.current = null;
      safeStorage.removeItem(COOLDOWN_KEY);
      hapticError();
      // "may": a stop also follows a re-check that could not be read.
      toast.error("This repair may already have a job", {
        description: "Nothing was charged here. Open the repair request to see its job.",
      });
      setSaving(false);
      setRedirecting(false);
      setStep("checkout");
      setConfirmed(false);
      submittingRef.current = false;
      return;
    }

    // Stash the just-posted job id so the post-payment success sheet can
    // show share-this-link / view-applicants / post-another-like-this
    // CTAs without re-querying Supabase. Cheap to write, the success
    // page consumes-and-clears so it doesn't leak across sessions.
    try { safeStorage.setItem("helpr_last_posted_job_id", jobData.id); } catch { /* ignore */ }

    // First job action recorded — gates the deferred notification
    // permission prompt (`useNotificationPermissionPrompt`). Idempotent
    // and fast, safe to call on every post.
    recordJobActionForPermissionPrompt();

    // Funnel: track job posted (and first ever for activation)
    track(AhaEvent.JobPosted, {
      job_id: jobData.id,
      category,
      budget_cents: Math.round(parseFloat(budget) * 100),
      parish,
      is_urgent: isUrgent,
    });
    const { count: postedCount } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", user.id);
    if ((postedCount ?? 0) <= 1) {
      track(AhaEvent.FirstJobPosted, { job_id: jobData.id, category, parish });
    }

    await uploadAndAttachPhotos(jobData.id);
    await uploadAndAttachScopeVideo(jobData.id);

    hapticSuccess();
    void maybeFireFirstPostConfetti();

    // Geocode the address and patch the job row with lat/lng so it shows
    // up on /browse?view=map. Kicked off here so it runs concurrently with
    // the create-payment round-trip below, then awaited before the redirect
    // (see geocodePromise await) — previously this was fire-and-forget, but
    // `window.location.href` to Stripe unloads the page and cancelled the
    // in-flight fetch, so most jobs never got coords and never hit the map.
    // The map's RPC rounds these to ~110m so the doorstep is never exposed.
    const geocodePromise = (async () => {
      const composed = composeJobAddress({
        streetAddress,
        city,
        state: addrState,
        zipCode,
      });
      const coords = await geocodeAddress(composed);
      if (coords) {
        // `error` is checked FIRST, and that is the whole fix. This used to
        // read `const { data: rows } = …` and then test
        // `rows && rows.length === 0` — which reports the BENIGN half and
        // swallows the real one. When the write genuinely fails (RLS denial,
        // network, PGRST202) supabase-js returns `{ data: null, error }`, so
        // `rows` is null, `rows && …` is false, and nothing was reported at
        // all. The one case it was written to catch was the one it missed.
        //
        // Still non-fatal — a job without coords is worse than a job that
        // failed to post — but no longer silent. This is the same class that
        // already shipped once, when the CSP blocked nominatim and both
        // geocode call sites swallowed it with `catch { return null }`; the
        // symptom is a job that simply never appears on /browse?view=map,
        // with nothing anywhere saying why.
        const { data: rows, error: geocodeWriteErr } = await supabase
          .from("jobs")
          .update({ latitude: coords.latitude, longitude: coords.longitude })
          .eq("id", jobData.id)
          .select("id");
        if (geocodeWriteErr) {
          report(geocodeWriteErr, {
            tags: { source: "PostJob.geocodeAttach" },
            context: { job_id: jobData.id, failure: "write_failed" },
          });
        } else if ((rows ?? []).length === 0) {
          report(new Error("job geocode update affected 0 rows"), {
            tags: { source: "PostJob.geocodeAttach" },
            context: { job_id: jobData.id, failure: "zero_rows" },
          });
        }
      }
    })();

    await startPayment(jobData.id, geocodePromise);
  };

  /**
   * Hand the poster to Stripe Checkout for `jobId`. Also the whole of a retry
   * whose job already exists (Q267): create-payment re-mints safely for a job
   * that already has an open session, so re-running this never needs a new job.
   */
  const startPayment = async (jobId: string, geocodePromise: Promise<unknown>) => {
    try {
      // One escrow door for every caller (src/lib/escrowCheckout.ts).
      // saveCardForFuture is an opt-in the edge function may honor, FORCED
      // for a recurring series: every later visit is charged off-session by
      // charge-recurring-visits, and with no saved card that cron can only
      // decline, so the poster would book a 12-week series and silently get
      // one visit (the checkout screen says so before they pay). A gift card
      // makes create-payment settle the gift instead of the full escrow.
      const { data: paymentData, error: paymentError } = await requestEscrowCheckout(jobId, {
        saveCardForFuture: saveCardForFuture || isRecurring,
        giftCardId,
        // The fee this screen showed (useJobDerived makes the same decision),
        // so create-payment can refuse a stale quote (owner 2026-10-18).
        feeQuote: buildFeeQuote({
          switchOn: posterFeeOn,
          jobPriceCents: Math.round(((parseFloat(budget) || 0) + (isUrgent ? parseFloat(urgentFee) || 0 : 0)) * 100),
        }),
      });



      setSaving(false);

      // supabase.functions.invoke wraps errors in `data.error` sometimes
      const paymentUrl = paymentData?.url;
      const hasError = paymentError || paymentData?.error || !paymentUrl;

      if (hasError) {
        // Q267: failed ON THE WIRE, so we never heard the answer. create-payment
        // may well have minted a Checkout Session and stamped it on this job
        // (then the delete below is refused anyway, and the job would linger
        // while a retry posted a SECOND one). Keep the job: attemptRef still
        // names it, so the retry pays for this same job.
        const outcomeUnknown = !paymentData?.error && isNetworkFailure(paymentError);
        // Q?gift-paid-retry-photos: a refusal for a job whose earlier payment
        // answer was lost may only mean it is PAID already (a gift card
        // settled it inside that lost call; the retry is refused as "already
        // processed"). Read the job before treating the refusal as a failure:
        // a funded job is the success the first answer would have been.
        const funded = outcomeUnknown ? null : await jobIsFunded(jobId);
        if (funded === true) {
          safeStorage.removeItem(COOLDOWN_KEY);
          // As on the success path below (a haul-away or "Add a Helpr" job never keeps a draft).
          if ((!haulAwayItemIds || haulAwayItemIds.length === 0) && !declutterOrderId) {
            flushDraft();
            safeStorage.setItem(DRAFT_CHECKOUT_JOB_KEY, jobId);
          }
          // Land the geocode write first, as the success path below does (money review of bf3cd5730 #6).
          try {
            await Promise.race([geocodePromise, new Promise((resolve) => window.setTimeout(resolve, 2500))]);
          } catch { /* best-effort — coords are non-critical */ }
          setRedirecting(true);
          attemptRef.current = null;
          // In-app route (the page create-payment's gift-settled answer opens).
          window.location.assign(`/payment-success?job_id=${encodeURIComponent(jobId)}`);
          return;
        }
        if (!outcomeUnknown && funded === false) {
          // The server answered with a refusal for a job that holds no money.
          // Delete the job since payment setup failed — don't leave orphan jobs.
          // Kept (a live checkout, or unreadable): it stays this attempt's job,
          // so a retry pays for it and never posts a second one.
          if (await cleanupOrphanJob(jobId)) {
            attemptRef.current = null;
            // A haul-away took its items off sale for this job: put them back.
            if (haulAwayItemIds && haulAwayItemIds.length > 0) await (await haulAwayLibOrNull())?.undoHaulAwayForJob(haulAwayItemIds, jobId);
          }
        }
        // funded === null after a refusal: the job could not be read, so it is
        // kept whole (attemptRef still names it, so a retry pays for it).
        safeStorage.removeItem(COOLDOWN_KEY);
        // Not `paymentError.message`: on a non-2xx that is supabase-js's
        // "Edge Function returned a non-2xx status code". The function's own
        // sentence is in the response body (see functionErrorMessage).
        const errorMsg = outcomeUnknown
          ? ""
          : endSentence(
            paymentData?.error ||
            (paymentError ? await functionErrorMessage(paymentError, "Payment setup failed") : "Payment setup failed"),
          );
        hapticError();
        toast.error(outcomeUnknown ? CONNECTION_TROUBLE_COPY : `Couldn't start payment: ${errorMsg} Please try again.`);
        setRedirecting(false);
        setStep("checkout");
        // Reset consent — payment failed, so the user must re-confirm
        // before retrying (avoids a stale confirmation being reused).
        setConfirmed(false);
        submittingRef.current = false;
        return;
      }

      // Keep the local draft through checkout (owner, 2026-09-27: an unpaid
      // job is never saved anywhere in Posts). A cancelled checkout lands on
      // /post-job, where "Load Draft" brings the form back; PaymentSuccess
      // clears it once the job is actually paid.
      // Not for a Declutter haul-away or "Add a Helpr" job: a draft cannot carry
      // its items or its order, so a job posted again from it would be paid with
      // no link (lh-money-escrow review 2026-10-16; review of 4f45a073f #4, the
      // haul-away rule). The seller books a haul-away again from My listings, the
      // buyer a setup Helpr from the order card.
      if ((!haulAwayItemIds || haulAwayItemIds.length === 0) && !declutterOrderId) {
        flushDraft();
        // Q769: remember which job this draft is paying for, so Post a Job can
        // tell a paid or still-payable checkout apart from a cancelled one
        // before it offers "Load Draft" again (useDraftCheckoutState).
        safeStorage.setItem(DRAFT_CHECKOUT_JOB_KEY, jobId);
      }
      // The instant-job-match fan-out USED to happen here. It has moved to
      // stripe-webhook's checkoutSessionCompleted, because "escrow is set up"
      // was never true at this point: create-payment only mints a Checkout
      // Session URL, and payment_status stays 'unpaid' until the poster
      // actually completes checkout and the webhook flips it to 'escrow'.
      //
      // Since migration 20260831010000 the browse RPCs only return jobs whose
      // payment_status is one of ('escrow','payout_pending','released'), so
      // every notification sent from here advertised a job no helper could
      // open — and if the poster abandoned the Stripe page, a job that never
      // became real at all. Firing it post-funding is the only placement where
      // the push and the browse result agree.
      //
      // This also removes a network round-trip that was being AWAITED on the
      // path to the checkout redirect.
      // Land the geocode write before the redirect unloads the page. It's
      // been running concurrently since job insert, so it's usually already
      // done; cap the wait at 2.5s so a slow/blocked Nominatim never stalls
      // checkout (the job is still usable, it just won't pin on the map).
      try {
        await Promise.race([
          geocodePromise,
          new Promise((resolve) => window.setTimeout(resolve, 2500)),
        ]);
      } catch { /* best-effort — coords are non-critical */ }
      // Show the blocking overlay before the redirect so the user can't
      // re-tap submit during the navigation delay on slow networks.
      setRedirecting(true);
      await openExternalUrl(paymentUrl);
      // Handed off: the next press is a new post, not a retry of this one.
      // Cleared only AFTER the redirect opened: if openExternalUrl throws, the
      // catch below keeps this attempt, so the retry pays for the same job
      // rather than posting a second one.
      attemptRef.current = null;
    } catch (err) {
      report(err, { tags: { source: "PostJob.paymentInvoke" }, context: { job_id: jobId } });
      // A throw is not a server refusal, so whether a Checkout Session now
      // exists is unknown — same as the on-the-wire case above (Q267). The job
      // is kept for the retry rather than deleted and posted again; if the
      // poster walks away it is an unpaid draft in Post a Job.
      safeStorage.removeItem(COOLDOWN_KEY);
      hapticError();
      toast.error("We couldn't set up payment just yet — please try again.");
      setSaving(false);
      setRedirecting(false);
      setStep("checkout");
      // Reset consent — same as the inline error path above.
      setConfirmed(false);
      submittingRef.current = false;
    }
  };

  return { handleReview, handleSubmit };
}
