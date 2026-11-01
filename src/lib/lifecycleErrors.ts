/**
 * Human copy for the preconditions our lifecycle RPCs enforce.
 *
 * These RPCs `RAISE EXCEPTION 'job_not_started'` (etc.) — deliberately terse,
 * machine-readable codes. The clients were funnelling every one of them into a
 * single generic "Couldn't do that — please try again", which is wrong twice
 * over: it hides a reason the user could act on, and "try again" is false
 * advice when the answer is "wait until the start time".
 *
 * Owner, 2026-08-25: "I'm trying to file a dispute but it's not letting me" /
 * "Also can't report no show". The guards were doing their job; nothing told
 * them so. (The no-show guards exist to close the R1 ban-abuse path — a poster
 * could otherwise ban any Helpr with two throwaway jobs — so they stay.)
 *
 * Unknown codes fall through to the caller's own fallback string.
 */
import { isWriteRejected } from "./mutationResult";
import { JOB_STARTS_TOO_SOON_COPY } from "./offerDeadline";
import { UNDER_18_APPLY_COPY } from "./ageGate";
import { DECLUTTER_ERROR_COPY as DC } from "./declutter/errors";
import { QUOTE_ERROR_COPY as QC } from "./quotes/errorCopy";
import { RENTALS_ERROR_COPY as RC } from "./rentals/errorCopy";

/**
 * THE ONE SENTENCE FOR THE BEFORE-PHOTO GATE ON "START WORKING".
 *
 * Exported because two surfaces say it and they must not drift: the client's
 * disabled "Start working" reason (JobTracking), and the copy for
 * `tracker_requires_before_photo`, which is what
 * `enforce_job_tracking_arrival_gate()` raises when a write reaches the server
 * anyway (20260919195158). It NAMES THE CONTROL that clears it — the "Before
 * Photo" chip in the card's action row — because a disabled button whose
 * reason does not say what to press is the defect, not the gate.
 */
export const BEFORE_PHOTO_GATE_REASON =
  'Tap "Before photo" and add one before you start working — it\'s the record of how the job looked when you got there.';

const LIFECYCLE_REASONS: Record<string, string> = {
  // Board 141: a cancel, back-out or no-show report while a refund request on
  // the job waits or is being settled (trg_refuse_job_move_while_refund_requested).
  refund_request_live:
    "There's a refund request on this job. Answer it, or withdraw it if you asked, before you change the booking.",
  // Board 141 (Q2326): the Helpr agreed to come back and finish; marking it
  // done waits for the agreed time (trg_refuse_done_before_come_back).
  completion_before_come_back:
    "You agreed to come back and finish this job. Mark it done once you have, from the agreed time.",
  // report_helper_no_show
  job_not_funded:
    "You can report a no-show once the job's payment is secured. This one isn't funded yet.",
  job_not_started:
    "It's not the scheduled start time yet — you can report a no-show once it passes.",
  already_reported: "You have already reported this Helpr as a no-show for this job.",
  // Q2291: the server's Louisiana-only address rule (jobs_address_in_louisiana).
  job_address_not_louisiana: "Helpr is in Louisiana only for now. Use a Louisiana address.",
  // Board 66/172 slice 4: the category is locked once people have applied.
  category_locked_after_applications: "People have applied to this kind of work, so the category stays. Post a new job for different work.",
  no_helper_assigned: "No Helpr has been assigned to this job yet.",
  not_authorized: "Only the person who posted this job can do that.",
  job_not_found: "We couldn't find that job.",
  // change_request_daily_cap, a BEFORE INSERT trigger on both change-request
  // tables (20261012045427, Q1501): 5 asks per person per job in a day.
  change_request_rate_limited: "You've asked to change this job a lot today. Wait a while, or message them to sort it out.",
  // dispute paths
  dispute_already_open: "There's already an open dispute on this job.",
  dispute_window_closed:
    "The dispute window for this job has closed. Contact support and we'll take a look.",
  // No RPC raises this today. It used to say a dispute opens once the work is
  // complete, which is the opposite of the rule (owner, 2026-09-14: done is
  // final), so it now says only what the code means.
  job_not_completed: "This job hasn't been marked complete yet.",
  // open_dispute_as, migration 20260915025607: a party filing (or appending
  // to) a dispute on a completed job. Done is final (owner, 2026-09-14).
  job_already_completed: "This job is finished, so it can't be disputed.",
  // rpc_open_dispute, migration 20260907032552. QA filed a dispute with the
  // description box empty on 2026-09-06 and it was accepted: the stored reason
  // was the literal "Other:" and an escrow froze for 72 hours on it. The RPC
  // rejects that now, so the dialog needs a sentence for it — a caller that
  // somehow gets past the client gate should be told what is missing, not
  // handed raw Postgres prose.
  dispute_needs_description:
    "Tell us what happened first — a dispute holds someone's payment, and an admin decides it from your description.",
  // Arrival and completion, migration 20260919155016 (owner, 2026-09-19: a
  // Helpr may always record an arrival; the poster confirms it in EVERY case,
  // GPS-verified or not). `mark_helper_arrival` no longer refuses a far or
  // fix-less arrival at all, so arrival_too_far / arrival_location_required /
  // arrival_location_invalid are gone from this table with the RAISEs that
  // produced them — see scripts/migration-raise-codes-allowlist.json.
  // SINCE 20261008203441 (owner, 2026-10-08, "GPS skips it") a GPS-verified
  // arrival clears both gates on its own; these fire only when the location
  // did not verify it, and then the poster's tap is the blocker.
  // enforce_helper_completion_gates — the Helpr's completion write.
  completion_requires_confirmed_arrival:
    "The person who posted this job has to tap \"Confirm they've arrived\" before you can mark it complete.",
  // enforce_job_tracking_arrival_gate — the tracker's next step.
  tracker_requires_arrival:
    "The person who posted this job has to tap \"Confirm they've arrived\" before you can start working.",
  // enforce_poster_working_confirm_order, 20261008203441 (Q1571).
  working_confirm_before_working: "Your Helpr hasn't tapped Start working yet — you can confirm once they do.",
  // enforce_job_tracking_arrival_gate — the Before photo, migration
  // 20260919195158 (owner, 2026-09-19: "if a before photo is required they
  // can't press the working button until its done"). A DISTINCT code from
  // tracker_requires_arrival on purpose: the two gates are cleared by two
  // different people's controls, and a Helpr shown the arrival sentence for a
  // missing photo would go and pester the poster for a tap that changes
  // nothing. Same string on both sides of the wire — the client's disabled
  // "Start working" renders BEFORE_PHOTO_GATE_REASON, so the sentence the
  // Helpr reads before the tap and the one the server sends if they get past
  // it cannot drift.
  tracker_requires_before_photo: BEFORE_PHOTO_GATE_REASON,
  tracker_requires_completion: "Mark the job complete first.",
  tracker_not_assigned_helper: "Only the Helpr assigned to this job can update its tracker.",
  // enforce_jobs_arrival_integrity — the poster's "Confirm they've arrived".
  // Since 20260919155016 a Helpr's check-in always stamps helper_arrived_at, so
  // this is reachable only by confirming a job whose Helpr has not tapped
  // Arrived at all.
  arrival_confirm_before_arrival:
    "Your Helpr hasn't marked arrived yet — you can confirm once they check in.",
  // open_dispute_as, migration 20260915034822. The new-dispute path used to
  // stamp `disputed` without checking the job was still disputable, so a filing
  // that raced a cancellation or a payout either froze an escrow that had
  // already been refunded or handed the filer `enforce_job_status_transition`'s
  // raw Postgres prose. It raises a terse code now, and this is its sentence.
  dispute_job_not_disputable:
    "This job has already been resolved or closed, so it can't be disputed. Refresh to see where it stands — if that looks wrong, contact support.",
  // open_dispute_as refuses a re-file while a decided dispute's split has not
  // executed (20260915034822).
  dispute_already_decided:
    "An admin has already decided this dispute and its payment is being settled, so it can't be reopened. Refresh to see the decision — if that looks wrong, contact support.",
  // rpc_withdraw_dispute / rpc_decide_dispute, 20260915034822: an admin
  // settlement holds this escrow for a few minutes. A designed refusal — see
  // EXPECTED_REFUSALS below.
  dispute_settlement_in_progress:
    "An admin is settling this dispute's payment right now, so it can't be changed. Refresh in a few minutes to see the result.",
  // rpc_decide_dispute, 20260926034348 (Q342 review M1): the card holder's bank
  // holds this job's payment in a card dispute, so no split could move it.
  dispute_job_charged_back:
    "The card holder's bank is holding this job's payment in a card dispute, so a decision here couldn't move any money. Settle it by hand once the bank rules.",
  // open_dispute_as refuses a job whose escrow cancel_escrow is refunding
  // (payment_status 'cancelling'), 20260915034822.
  dispute_payment_being_cancelled:
    "This job's payment is being cancelled and refunded, so it can't be disputed. Refresh to see where it stands — if that looks wrong, contact support.",
  // enforce_helper_award_gate, 20261003193541 (Q1180): an offer is not a
  // booking. Nothing starts, finishes or is disputed until the Helpr's accept
  // is complete, whoever tries (arrival, a status PATCH, a dispute).
  accept_required:
    "This job isn't booked yet: its offer hasn't been accepted. Nothing can start, finish or be disputed until it is.",
};

// Sentences more than one RPC needs, written once so they cannot drift.
const JOB_GONE = "This job no longer exists. Refresh and check.";
const NO_LONGER_BOOKED_STATUS = "You're no longer booked on this job, so your status can't be updated.";
const JOB_NOT_ACTIVE_STATUS = "This job isn't active any more, so your status can't be updated.";
const ACCEPT_REASONS = {
  job_not_open: "This job is no longer open — it may already be assigned.",
  application_not_found: "This application no longer exists — the applicant may have withdrawn.",
  application_not_pending: "This applicant can no longer be accepted.",
  not_authorized: "You can only accept applicants on a job you posted.",
  // Q345: the two of you are blocked (either direction). Never says who blocked.
  applicant_blocked: "This person can no longer be hired for this job.",
} as const;

/**
 * PER-RPC copy for every custom code a client-called RPC raises.
 *
 * WHY PER RPC, NOT PER CODE. One code means different things behind different
 * doors. `job_already_completed` from `rpc_open_dispute` means "you can't
 * dispute a finished job"; the same code surfacing through `helper_abort_job`
 * means "you can't cancel it, it was just marked complete". `not_authorized`
 * is "only the person who posted this job" on a no-show report and "you're no
 * longer booked on this job" on a Helpr's cancel. A single code→copy table
 * says the wrong thing at one of the two.
 *
 * Every entry here is checked against the migrations by
 * `src/test/rpcErrorCopyCoverage.test.ts`: each code a client-called RPC can
 * raise (its latest definition plus the functions it calls) must be mapped
 * here or allowlisted there with a reason, every call site must read this
 * table through `rpcErrorMessage` / `rpcErrorCode`, and an entry for a code
 * the RPC no longer raises fails too.
 *
 * Copy rules: never addressed to one role, "Helpr" spelled so, and done is
 * final — nothing here sends anyone to support about a completed job.
 *
 * ADMIN-ONLY RPCs ARE NOT HERE. An RPC whose definition refuses anyone without
 * the admin role keeps its words in ADMIN_RPC_ERROR_COPY
 * (src/components/admin/adminRpcErrorCopy.ts), which only the admin console's
 * lazy chunks import: this table rides in a chunk every signed-in first screen
 * downloads, and an admin's refusal copy is bytes no member ever reads.
 * src/test/rpcErrorCopyCoverage.test.ts holds both tables to the same rules and
 * fails if an admin-gated RPC's copy is put back here.
 */
export const RPC_ERROR_COPY = {
  // useOfferHandlers — accepting an applicant (single and group).
  accept_application: {
    ...ACCEPT_REASONS,
    // 20261005184940: an offer is never sent into a job that starts within 15 minutes.
    job_starts_too_soon: JOB_STARTS_TOO_SOON_COPY,
    invalid_deadline: "That answer-by time has already passed. Pick a longer window and try again.",
  },
  // Hiring an applicant at the day/time they suggested (owner 2026-10-23, 20261023134752).
  accept_application_at_suggested_time: {
    ...ACCEPT_REASONS,
    job_starts_too_soon: JOB_STARTS_TOO_SOON_COPY,
    invalid_deadline: "That answer-by time has already passed. Pick a longer window and try again.",
    no_suggested_time: "This applicant didn't suggest a different time. Close this and hire them as usual.",
    suggestion_not_allowed: "This job now keeps one time for everyone, so their suggested time can't be used. Message them about your time instead.",
    suggestion_too_soon: "Their suggested time is less than 2 hours away. Message them to pick a later time, or hire someone else.",
  },
  accept_group_application: {
    job_starts_too_soon: JOB_STARTS_TOO_SOON_COPY,
    ...ACCEPT_REASONS,
    // Q1390: a spot a block closed counts as taken too.
    roster_full: "Every spot on this job is taken, so no one else can be added.",
    not_a_group_job: "This job isn't set up as a group job any more. Refresh and try again.",
    invalid_helpers_needed:
      "This job doesn't say how many people it needs. Edit the job to set that, then try again.",
  },
  // PhotoProof — a crew member's OWN before/after photos (Q407: a crew has no
  // lead, so each member's proof lives on their own roster row).
  rpc_group_member_set_proof: {
    not_authenticated: "Sign in again to add your photos.",
    not_on_this_crew: "You're not on this job's crew any more, so you can't add photos to it.",
    part_already_done: "You already marked your part done, so its photos are part of the record now.",
  },
  // CrewMemberSection — a crew member's own steps on their roster row (Q1382).
  rpc_group_member_confirm: {
    not_authenticated: "Sign in again to accept your spot.",
    not_on_this_crew: "You're not on this job's crew any more.",
    job_not_confirmable: "This job isn't live any more, so your spot can't be accepted. Refresh the page.",
    helper_unknown: "We couldn't read your account right now. Try again in a moment.",
    // Q2399: the poster's card is only held; capture_hold charges it first (cardHoldCapture.ts).
    payment_not_captured: "This job is waiting on payment. We've let the person who posted it know.",
  },
  rpc_group_member_on_the_way: {
    not_authenticated: "Sign in again to update your status.",
    not_on_this_crew: NO_LONGER_BOOKED_STATUS,
    job_not_active: "You can head out once the job is booked. At the start time it goes ahead with whoever's on the crew.",
    helper_not_confirmed: "Accept your spot first, then mark yourself on the way.",
  },
  rpc_group_member_mark_arrival: {
    not_authenticated: "Sign in again to check in.",
    not_on_this_crew: NO_LONGER_BOOKED_STATUS,
    job_not_active: "You can check in once the job is booked. At the start time it goes ahead with whoever's on the crew.",
    helper_not_confirmed: "Accept your spot first, then check in.",
  },
  rpc_group_member_mark_done: {
    not_authenticated: "Sign in again to mark your part done.",
    not_on_this_crew: "You're not on this job's crew any more, so you can't mark a part done.",
    part_not_completable: "Your part couldn't be marked done. Refresh the page and check where the job stands.",
    // A crew spot closed while the last Done ran (20261006031350): nothing was
    // finished, so the member just tries again.
    crew_changed_under_completion: "The crew changed while you were marking done. Refresh the page and try again.",
    // The per-member completion gates are raised by the roster TRIGGER
    // (enforce_group_member_completion_gates), which this inventory does not
    // follow; their copy is CREW_DONE_GATE_COPY in src/lib/crewLifecycle.ts.
  },
  // GroupJobHelpers — the poster's per-member "Confirm they've arrived".
  rpc_poster_confirm_member_arrival: {
    not_authenticated: "Sign in again to confirm an arrival.",
    not_the_poster: "Only the person who posted this job can confirm a Helpr arrived.",
    job_not_active: "This job isn't active any more, so arrivals can't be confirmed.",
    not_on_this_crew: "That Helpr isn't on this crew any more. Refresh the page.",
    arrival_confirm_before_arrival: "That Helpr hasn't checked in yet. You can confirm once they tap I've arrived.",
  },
  // GroupJobHelpers — the poster's per-member "Confirm work" (JOBS-3, 20261101044659).
  rpc_poster_approve_member: {
    not_authenticated: "Sign in again to confirm a Helpr's work.",
    job_not_found: "This job isn't available any more. Refresh the page.",
    not_authorized: "Only the person who posted this job can confirm a Helpr's work.",
    not_a_crew_job: "This job has one Helpr. Approve the job itself instead.",
    job_not_active: "This job isn't under way any more, so a Helpr's work can't be confirmed on its own.",
    job_not_funded: "The payment for this job isn't being held, so nobody can be paid from it.",
    job_disputed: "This job has a dispute, so an admin decides who is paid.",
    not_on_this_crew: "That Helpr isn't on this crew any more. Refresh the page.",
    helper_not_done: "This Helpr hasn't marked their part done yet.",
    already_approved: "You already confirmed this Helpr's work.",
    crew_share_not_frozen: "This Helpr is paid when you approve the whole job.",
  },
  // GroupJobHelpers — the poster's per-member "Didn't show" (JOBS-3, 20261101031804).
  rpc_poster_report_member_no_show: {
    not_authenticated: "Sign in again to report a no-show.",
    job_not_found: "This job isn't available any more. Refresh the page.",
    crew_changed_under_completion: "The crew changed while you were reporting. Refresh the page and try again.",
    not_authorized: "Only the person who posted this job can report a crew member as a no-show.",
    not_a_crew_job: "This job has one Helpr. Use Report No-Show on the job instead.",
    job_not_active: "This job isn't active any more, so a no-show can't be reported.",
    job_not_funded: "A no-show can only be reported on a paid job.",
    job_not_started: "Wait until the start time before reporting a no-show.",
    already_reported: "You already reported this crew member as a no-show.",
    not_on_this_crew: "That Helpr isn't on this crew any more. Refresh the page.",
    helper_never_accepted: "This Helpr never confirmed their spot, so it closes on its own with no strike.",
    helper_already_done: "This Helpr marked their part done, so they can't be a no-show.",
    helper_already_arrived: "This Helpr checked in on this job, so they can't be reported as a no-show.",
    helper_near_miss_pending: "This Helpr checked in near the job, a little way from its map pin. If they're there, confirm their arrival; if not, contact support.",
  },
  // useOfferHandlers — responding to a direct offer.
  respond_to_direct_offer: {
    offer_expired: "This offer expired — the job is open to everyone again.",
    offer_not_pending: "This offer isn't yours to respond to any more.",
    not_your_offer: "This offer isn't yours to respond to any more.",
    job_not_open: "This job is no longer open.",
    job_not_found: "This job is no longer available.",
    // Q345: blocked in either direction. Never says who blocked.
    applicant_blocked: "This offer is no longer available to you.",
    // Q1185: the accept now completes through complete_job_accept, and is
    // refused up front for what the deferred completion would refuse.
    offer_not_active: "This offer is no longer available — it may have expired or gone to someone else.",
    helper_unknown: "We couldn't read your account right now. Try again in a moment.",
    credential_tier_required: "You don't have the credentials this job requires. Add your license or insurance in your profile to accept it.",
    // Q1401: the listing closes at the job's start (job_offer_cutoff), not its day.
    job_date_has_passed: "This job has already started, so the offer can't be accepted.",
    // Q2399: the poster's card is only held; capture_hold charges it first (cardHoldCapture.ts).
    payment_not_captured: "This job is waiting on payment. We've let the person who posted it know.",
    job_expired: "This posting has expired.",
    job_not_funded: "This job's payment isn't secured right now, so the offer can't be accepted yet.",
    account_restricted: "Your account is restricted right now, so you can't accept jobs.",
    // CMP-4: a decline of an instant booking is the instant decline (20261101071621).
    not_authenticated: "Sign in again to continue.",
    booking_not_pending: "This booking already ended. Refresh the page to see where it stands.",
    decline_window_closed: "The 2 hours to decline have ended, so you're booked.",
  },
  // CMP-4 instant book (20261101063725, 20261101065105, 20261101071621). Guard: src/test/instantBookScreens.test.tsx.
  rpc_my_instant_book_floors: {
    not_authenticated: "Sign in again to see your instant book settings.",
  },
  rpc_set_instant_book_floor: {
    not_authenticated: "Sign in again to save this.",
    account_restricted: "Your account is restricted right now, so you can't change this.",
    invalid_category: "Choose a kind of work from the list.",
    floor_out_of_range: "Pick an amount between $10 and $1,000.",
    too_many_categories: "You can pick up to 3 kinds of work. Remove one to add another.",
    feature_disabled: "Instant book is turned off right now.",
  },
  instant_book_candidates: {
    account_restricted: "Your account is restricted right now, so you can't book a Helpr.",
    not_authorized: "Only the person who posted this job can book a Helpr for it.",
    feature_disabled: "Instant book is turned off right now.",
  },
  rpc_instant_book: {
    not_authenticated: "Sign in again to book a Helpr.",
    account_restricted: "Your account is restricted right now, so you can't book a Helpr.",
    not_authorized: "Only the person who posted this job can book a Helpr for it.",
    instant_book_unavailable: "That Helpr can't be booked now. Pick another, or wait for applications.",
    feature_disabled: "Instant book is turned off right now.",
  },
  rpc_instant_book_decline: {
    not_authenticated: "Sign in again to continue.",
    not_your_offer: "This booking isn't yours anymore.",
    booking_not_pending: "This booking already ended. Refresh the page to see where it stands.",
    decline_window_closed: "The 2 hours to decline have ended, so you're booked.",
  },
  // useOfferHandlers — the Helpr's Accept (Q1180).
  accept_job_offer: {
    offer_not_active: "This offer is no longer available — it may have expired or gone to someone else.",
    offer_expired: "This offer is no longer available — it may have expired.",
    group_job_not_supported: "Crew jobs are confirmed from the crew card.",
    not_authorized: "This offer isn't yours to respond to.",
    job_not_found: "This job is no longer available.",
    account_restricted: "Your account is restricted right now, so you can't accept jobs.",
    helper_unknown: "We couldn't read your account right now. Try again in a moment.",
    job_not_funded: "This job's payment isn't secured right now, so the offer can't be accepted yet.",
    // Q2399: the poster's card is only held; capture_hold charges it first (cardHoldCapture.ts).
    payment_not_captured: "This job is waiting on payment. We've let the person who posted it know.",
  },
  // PaymentSuccess (src/lib/cardHoldRead.ts) — the poster's own card hold (Q2399).
  get_my_job_card_hold: {
    feature_disabled: "Your card hold can't be shown right now. Open the job to see its payment.",
  },
  // useOfferHandlers — declining an accepted offer.
  decline_job_offer: {
    offer_not_active: "This job isn't yours to respond to any more — someone else may have been booked.",
    application_not_found: "This offer no longer exists — the job may have been removed.",
    not_authorized: "This offer isn't yours to respond to.",
  },
  // useApplyFlow — the apply rate limits.
  apply_to_job: {
    rate_limit_minute: "Slow down — you can apply again in a minute.",
    rate_limit_hour: "You've applied to a lot of jobs this hour — try again in a bit.",
    rate_limit_day: "You've hit today's application limit — check back tomorrow.",
    // Q1586(c), 20261013010621: a saved birthday under 18.
    under_18: UNDER_18_APPLY_COPY,
  },
  // "Suggest another time" on the apply sheet (owner 2026-10-23, 20261023134752). Its own refusals
  // only; everything apply_to_job raises inside it is read through apply_to_job's copy at the call site.
  apply_to_job_with_time: {
    // Raised by the apply_to_job it runs inside (same words as apply_to_job's).
    rate_limit_minute: "Slow down — you can apply again in a minute.",
    rate_limit_hour: "You've applied to a lot of jobs this hour — try again in a bit.",
    rate_limit_day: "You've hit today's application limit — check back tomorrow.",
    under_18: UNDER_18_APPLY_COPY,
    suggestion_not_allowed: "This job keeps one time for everyone, so a different time can't be suggested. Choose \"Yes, that works\" to apply.",
    suggestion_date_invalid: "Pick a day from today to 90 days out for the time you suggest.",
    suggestion_same_as_job: "That's the job's own day and time. Choose \"Yes, that works\" instead.",
  },
  // CancellationDialog.
  poster_cancel_job: {
    not_cancellable:
      "This job couldn't be cancelled — it may have already been cancelled, finished, or opened as a dispute. Refresh and check.",
    not_authorized: "Only the person who posted this job can cancel it.",
    job_not_found: JOB_GONE,
    not_authenticated: "Please sign in again to cancel this job.",
    // Boards 66/172 slice 2 (20261021130723): the fee moved a tier since the dialog quoted it; nothing was cancelled.
    quote_changed: "The amount for your Helpr's time changed while this was open, so nothing was cancelled. Check the new amount and confirm again.",
  },
  // EndSeriesControl — the poster ends a recurring series; a Helpr on it leaves.
  end_recurring_series: {
    not_authorized: "Only the person who posted this series, or a Helpr with upcoming dates on it, can do that.",
    not_a_series: "This job isn't a recurring series, so there is nothing to end. Refresh and check.",
    job_not_found: JOB_GONE,
    not_authenticated: "Please sign in again to end this series.",
  },
  // ScheduleChangeControl — asking for a new date/time on a booked job (Q407 8).
  request_job_schedule_change: {
    not_authorized: "Only the two people on this job can ask to change its date or time.",
    schedule_change_not_one_time: "A crew job or a recurring series keeps its schedule. A series' dates change from the series itself.",
    schedule_change_not_booked: "This job isn't booked any more, so its date or time can't be changed this way. Refresh and check.",
    schedule_change_too_late: "The job has already started, so its date or time can't be changed now.",
    schedule_change_in_past: "Pick a date and time that are still ahead.",
    schedule_change_too_soon: "Pick a start at least an hour from now, so they have time to answer.",
    schedule_change_same: "That's the date and time the job already has.",
    schedule_change_invalid: "Pick a date for the new time.",
    schedule_change_clash: "The Helpr already has another booked job at that time. Pick a different time.",
    account_restricted: "Your account is restricted, so you can't ask for changes right now.",
    job_not_found: JOB_GONE,
    not_authenticated: "Please sign in again to ask for a change.",
  },
  // Board 66/172 slice 3: whoever asked takes a pending request back.
  withdraw_job_schedule_change: {
    not_authorized: "Only the person who asked can take this request back.",
    request_not_found: "That request no longer exists. Refresh to see the job as it is.",
    account_restricted: "Your account is restricted, so you can't change requests right now.",
    not_authenticated: "Please sign in again to take this request back.",
  },
  respond_job_schedule_change: {
    not_authorized: "Only the other person on this job can answer this request.",
    request_not_found: "That request no longer exists. Refresh to see the job as it is.",
    account_restricted: "Your account is restricted, so you can't answer requests right now.",
    not_authenticated: "Please sign in again to answer this request.",
  },
  // EnterReferralCodeCard — a friend's code within 7 days of joining (owner 2026-10-25).
  claim_my_referral_code: {
    account_restricted: "Your account is restricted right now, so you can't add a referral code.",
  },
  // FindHelprs — "Find a Helpr" by skill and town (Q2437, owner 2026-10-27).
  find_helprs: {
    not_signed_in: "Please sign in again to find a Helpr.",
    account_restricted: "Your account is restricted right now, so you can't browse Helprs.",
    email_not_confirmed: "Confirm your email to browse Helprs.",
    search_too_long: "That search is too long. Try a shorter skill or town.",
  },
  // SeriesDatesPanel — picking visit dates on a series (Q407 5).
  claim_series_dates: {
    not_authorized: "You can pick dates once the person who posted this series offers them to you, or once you have dates on it.",
    not_a_series: "This job isn't a recurring series. Refresh and check.",
    series_ended: "This series has ended, so there are no dates left to pick.",
    applicant_blocked: "You can't pick dates on this series.",
    account_restricted: "Your account is restricted, so you can't pick up dates right now.",
    job_not_found: JOB_GONE,
    not_authenticated: "Please sign in again to pick dates.",
    helper_unknown: "We couldn't read your account right now. Try again in a moment.",
  },
  // SeriesDatesPanel — handing dates back (Q407 6).
  give_up_series_dates: {
    not_your_dates: "Those dates aren't yours to give up, or their visits are already booked. Cancel a booked visit from its own card.",
    not_authorized: "Only someone on this series can give up its dates. Refresh and check.",
    not_a_series: "This job isn't a recurring series. Refresh and check.",
    job_not_found: JOB_GONE,
    not_authenticated: "Please sign in again to give up dates.",
  },
  // SeriesDatesPanel — the poster offers the open dates to someone who applied.
  offer_series_dates: {
    not_an_applicant: "You can offer dates only to someone who applied to this series, or who has finished a job for you before.",
    nothing_to_offer: "Every upcoming date already has a Helpr, so there is nothing to offer.",
    helper_unavailable: "That person's account is restricted right now, so they can't take dates.",
    series_blocked: "You can't offer dates to someone you've blocked or who has blocked you.",
    series_ended: "This series has ended, so there are no dates to offer.",
    not_authorized: "Only the person who posted this series can offer its dates.",
    not_a_series: "This job isn't a recurring series. Refresh and check.",
    account_restricted: "Your account is restricted, so you can't offer dates right now.",
    job_not_found: JOB_GONE,
    not_authenticated: "Please sign in again to offer dates.",
  },
  // ConfirmedSection — cancelling a booking before the start.
  helper_cancel_booking: {
    job_already_started:
      "The start time has passed, so this can't be cancelled here — message the person who posted this job, or contact support if you can't reach them.",
    not_cancellable:
      "This booking can't be cancelled any more — the job has already moved on. Refresh to see where it stands.",
    job_not_found: JOB_GONE,
    not_authorized: "You're no longer booked on this job, so there's nothing to cancel.",
    // Q706: an offer the Helpr has not accepted is declined, not cancelled.
    offer_not_accepted: "You haven't accepted this offer yet, so there's no booking to cancel. Decline the offer instead.",
  },
  // ActiveJobSection — Cancel job once work is underway.
  helper_abort_job: {
    not_abortable: "This job has already moved on. Refresh the page and take another look.",
    // Raised by open_dispute_as (via rpc_open_dispute) when the job was
    // marked complete in the moment before this Cancel job landed. Done is
    // final (owner, 2026-09-14): say what happened, no support detour.
    job_already_completed: "This job was just marked complete, so it can't be cancelled.",
    // Also open_dispute_as: a reason that ends in a colon reads as empty.
    dispute_needs_description: "Add a little more about why you can't finish, then try again.",
    job_not_found: JOB_GONE,
    not_authorized: "You're no longer booked on this job, so it can't be cancelled from here.",
    // open_dispute_as (via the abort-dispute path), 20260915034822.
    dispute_job_not_disputable: "This job has already been resolved or closed, so it can't be disputed. Refresh to see where it stands — if that looks wrong, contact support.",
    dispute_already_decided: "An admin has already decided this dispute and its payment is being settled, so it can't be reopened. Refresh to see the decision — if that looks wrong, contact support.",
    dispute_payment_being_cancelled: "This job's payment is being cancelled and refunded, so it can't be disputed. Refresh to see where it stands — if that looks wrong, contact support.",
    dispute_evidence_invalid_url: "A photo couldn't be attached to this dispute. Remove it and try again.",
    // rpc_open_dispute's Q1244 cooldown (20261005062746): Cancel job files through it.
    dispute_refile_cooldown: "You withdrew a dispute on this job recently. Wait before filing again: 10 minutes after your first withdrawal, an hour after the second, a full day after that. Or message the other party.",
  },
  // JobTracking — "I'm on my way" and arrival check-in.
  helper_mark_on_the_way: {
    job_not_found: JOB_GONE,
    not_the_assigned_helper: NO_LONGER_BOOKED_STATUS,
    job_not_active: JOB_NOT_ACTIVE_STATUS,
    helper_not_confirmed: "Accept this job first, then mark yourself on the way.",
    // 20261008203441 (Q1570): the Helpr's own day-before tap, then 2 h before the start.
    helper_not_dayof_confirmed: "Tap Confirm first, then you can head out.",
    on_the_way_too_early: "I'm on my way turns on 2 hours before the job starts.",
  },
  nudge_confirm: {
    job_not_found: JOB_GONE,
    not_a_party: "Only the two people on this job can nudge each other.",
  },
  mark_helper_arrival: {
    job_not_found: JOB_GONE,
    not_the_assigned_helper: NO_LONGER_BOOKED_STATUS,
    job_not_active: JOB_NOT_ACTIVE_STATUS,
    // 20260919155016: the RPC no longer refuses ANYTHING about the location —
    // it records the arrival and returns a verdict (`arrivalVerdictFromRpc` in
    // arrivalGate.ts). The three location codes that used to live here went
    // with the RAISEs; only these three structural refusals remain.
  },
  // JobTracking — the Helpr's "I'm Done". The client pre-checks arrival, proof
  // and the 30-minute floor and shows those toasts first; these are the table
  // copy for a race that reaches the RPC anyway (20260915073143).
  rpc_helper_mark_done: {
    job_not_found: JOB_GONE,
    not_the_assigned_helper: "You're no longer the Helpr on this job, so you can't mark it done.",
    job_not_completable: "This job isn't active any more, so it can't be marked done. Refresh the page.",
    completion_requires_confirmed_arrival: LIFECYCLE_REASONS.completion_requires_confirmed_arrival,
    completion_requires_proof_photos: "Add before and after photos before marking the job done.",
    completion_min_work_time: "You can mark it done 30 minutes after you arrived.",
    // LEAD-LIST-FOR-SELLER (20261101034159): a Have a Helpr list it job is done once its listings are sent.
    completion_requires_listings_sent: "Send the listings to the seller for approval first, then mark the job done.",
  },
  // userBlocks — block and settle shared jobs.
  block_user_and_settle: {
    invalid_target: "You can't block this account.",
  },
  // RecipientPicker — gift-card recipient name search.
  search_profiles_by_name: {
    rate_limit_minute: "Too many searches in a row. Wait a minute, or type their email address instead.",
    rate_limit_day: "You've reached today's search limit. Type their email address instead, or try again tomorrow.",
  },
  // The "Louisiana Helpr Team" thread (20261011161100): the user's reply. The
  // admin's side (admin_send_team_message) is in src/components/admin/adminRpcErrorCopy.ts.
  send_team_reply: {
    empty_message: "Write a message first.",
    message_too_long: "That message is too long. Messages are limited to 4,000 characters.",
    no_team_thread: "This conversation can't take new messages right now.",
    not_authenticated: "Your session ended. Sign in again to send this.",
  },
  // useLifecycleHandlers — the shared lifecycle sentences, unchanged.
  report_helper_no_show: {
    job_not_found: LIFECYCLE_REASONS.job_not_found,
    not_authorized: LIFECYCLE_REASONS.not_authorized,
    no_helper_assigned: LIFECYCLE_REASONS.no_helper_assigned,
    job_not_funded: LIFECYCLE_REASONS.job_not_funded,
    job_not_started: LIFECYCLE_REASONS.job_not_started,
    already_reported: LIFECYCLE_REASONS.already_reported,
    // Q1180 (20261003193541): an offer that was never accepted is not a no-show.
    helper_never_accepted: "This Helpr never accepted the offer, so it can't be a no-show. You can pick someone else from your applicants.",
    // 20260915044137 (VN-33): an arrival means the server found them at the
    // job, so it is not a no-show. The app hides No-Show then; a stale card
    // can still send it.
    helper_already_arrived:
      "Your Helpr has already marked arrived on this job, so it can't be reported as a no-show.",
    // VN-33(b): their location was recorded near the job in the last 12h.
    helper_near_miss_pending:
      "Your Helpr checked in near the job, but a little way from its map pin. If they're there, tap Confirm they've arrived. If not, contact support.",
  },
  // DisputeDialog.
  rpc_open_dispute: {
    dispute_needs_description: LIFECYCLE_REASONS.dispute_needs_description,
    job_already_completed: LIFECYCLE_REASONS.job_already_completed,
    // open_dispute_as refusals, 20260915034822.
    dispute_job_not_disputable: "This job has already been resolved or closed, so it can't be disputed. Refresh to see where it stands — if that looks wrong, contact support.",
    dispute_already_decided: "An admin has already decided this dispute and its payment is being settled, so it can't be reopened. Refresh to see the decision — if that looks wrong, contact support.",
    dispute_payment_being_cancelled: "This job's payment is being cancelled and refunded, so it can't be disputed. Refresh to see where it stands — if that looks wrong, contact support.",
    dispute_evidence_invalid_url: "A photo couldn't be attached to this dispute. Remove it and try again.",
    // Q1244 (20261005062746): no open/withdraw loop on one job.
    dispute_refile_cooldown: "You withdrew a dispute on this job recently. Wait before filing again: 10 minutes after your first withdrawal, an hour after the second, a full day after that. Or message the other party.",
  },
  // DisputeTimelineDialog — adding evidence to a dispute an admin re-opened.
  rpc_add_dispute_evidence: {
    dispute_evidence_empty: "Attach between one and ten photos, then try again.",
    dispute_evidence_invalid_url: "Only photos you uploaded to this dispute can be attached. Remove that photo and try again.",
    dispute_evidence_limit: "This dispute already holds as much evidence as it can take, so no more photos can be added.",
    dispute_evidence_not_allowed: "This dispute isn't taking new evidence any more — it may already have been decided. Refresh to see where it stands.",
  },
  // Shops (docs/specs/local-shops-prep.md): the shops_* RPCs keep their words in
  // src/lib/shops/rpcErrorCopy.ts (SHOPS_RPC_ERROR_COPY), loaded only with the
  // Shops screens, so the shared signed-in bundle does not carry them (/posts
  // critical-path budget, 2026-10-17), as the Helpr task RPCs do.
  // Declutter (docs/specs/declutter-auctions.md): the words live in
  // src/lib/declutter/errors.ts (DECLUTTER_ERROR_COPY, exact against the
  // migrations); each RPC maps exactly the codes it can raise.
  // Slice 5 (20261017055505): the Helpr task RPCs (helpr_*) keep their words in
  // src/lib/helprTasks/errorCopy.ts (HELPR_TASK_RPC_ERROR_COPY), loaded only with
  // the delivery screens, so the shared signed-in bundle does not carry them
  // (/posts critical-path budget, 2026-10-17).
  // Slice 4 (20261015042253): pickup, handover, porch, no-shows, problems, reviews.
  // D-NEW11 "I'm on my way" (the pickup-day card).
  declutter_on_my_way: {
    account_restricted: DC.account_restricted,
    item_not_found: DC.item_not_found,
    not_a_pickup: "This order isn't a pickup that's waiting.",
    not_authenticated: DC.not_authenticated,
    not_booked_yet: DC.not_booked_yet,
    not_pickup_day: "You can tell the seller on the day of your pickup.",
  },
  declutter_book_pickup: {
    account_restricted: DC.account_restricted,
    invalid_slot: DC.invalid_slot,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    not_booked_yet: DC.not_booked_yet,
    order_not_paid: DC.order_not_paid,
    problem_open: DC.problem_open,
    reschedule_used: DC.reschedule_used,
  },
  // Porch pickup day (20261028225038, owner 2026-10-28).
  declutter_book_porch_day: {
    account_restricted: DC.account_restricted,
    invalid_day: DC.invalid_day,
    item_not_found: DC.item_not_found,
    not_a_porch_pickup: DC.not_a_porch_pickup,
    not_authenticated: DC.not_authenticated,
    not_booked_yet: DC.not_booked_yet,
    order_not_paid: DC.order_not_paid,
    problem_open: DC.problem_open,
    reschedule_used: DC.reschedule_used,
    seller_set_out: DC.seller_set_out,
  },
  declutter_porch_days: {
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  // A1-B2 (20261029161237): what the buyer's card was charged, read for at most 200 of their own orders at once.
  declutter_my_paid_cents: {
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    too_many_orders: "There are too many orders to total at once. Open an order to see what you paid for it.",
  },
  declutter_confirm_handover: {
    account_restricted: DC.account_restricted,
    delivery_not_done: DC.delivery_not_done,
    // An old build still sends the removed code method (owner 2026-10-18: no codes).
    invalid_method: "Handovers no longer use a code. Update the app, then tap \"I got it\" when you have the item.",
    invalid_payout: DC.invalid_payout,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    no_delivery_fee: DC.no_delivery_fee,
    not_authenticated: DC.not_authenticated,
    // A seller delivery before it was marked delivered or its day (20261028202844, #7).
    not_delivered_yet: DC.not_delivered_yet,
    order_not_paid: DC.order_not_paid,
    problem_open: DC.problem_open,
    wrong_side: DC.wrong_side,
    // A meetup or door pickup: "I got it" waits for a booked time and the hour before it (20261030061753, audit 1030 DB-3).
    got_it_too_early: DC.got_it_too_early,
    not_booked_yet: "No time is booked yet. Book a time, then tap \"I got it\" when you have the item.",
  },
  declutter_item_address: {
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
  },
  // Deep audit #2 + #58 (20261028195840): the seller's pickup windows, for a listing or an order.
  declutter_item_pickup_windows: {
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_item_pickup_places: {
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_order_pickup_windows: {
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_leave_review: {
    account_restricted: DC.account_restricted,
    already_reviewed: DC.already_reviewed,
    comment_too_long: DC.comment_too_long,
    invalid_stars: DC.invalid_stars,
    invalid_tags: DC.invalid_tags,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    not_handed_over: DC.not_handed_over,
    review_contact_info: DC.review_contact_info,
  },
  declutter_porch_photo: {
    account_restricted: DC.account_restricted,
    delivery_not_done: DC.delivery_not_done,
    invalid_method: DC.invalid_method,
    invalid_payout: DC.invalid_payout,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    location_required: DC.location_required,
    no_delivery_fee: DC.no_delivery_fee,
    not_a_porch_pickup: DC.not_a_porch_pickup,
    not_at_pickup: DC.not_at_pickup,
    not_booked_yet: DC.not_booked_yet,
    order_not_paid: DC.order_not_paid,
    photo_not_uploaded: DC.photo_not_uploaded,
    photo_too_old: DC.photo_too_old,
    // Audit 1a #4 (20261029201542): the seller's photo before the buyer's booked day.
    porch_day_not_yet: DC.porch_day_not_yet,
    problem_open: DC.problem_open,
  },
  declutter_porch_note: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_a_porch_pickup: DC.not_a_porch_pickup,
    not_authenticated: DC.not_authenticated,
    note_too_long: DC.note_too_long,
    photo_first: DC.photo_first,
  },
  declutter_seller_picked_up: {
    account_restricted: DC.account_restricted,
    before_pickup_time: DC.before_pickup_time,
    delivery_not_done: DC.delivery_not_done,
    invalid_method: DC.invalid_method,
    invalid_payout: DC.invalid_payout,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    // Anti-lying #1 (20261028235709): a "Picked up" photo is taken where the handover is.
    location_required: "Turn on location so we can confirm where you took the photo.",
    no_delivery_fee: DC.no_delivery_fee,
    no_show_reported: DC.no_show_reported,
    not_a_door_pickup: DC.not_a_door_pickup,
    not_at_meetup: DC.not_at_meetup,
    not_at_pickup: DC.not_at_pickup,
    not_authenticated: DC.not_authenticated,
    not_booked_yet: DC.not_booked_yet,
    order_not_paid: DC.order_not_paid,
    photo_not_uploaded: DC.photo_not_uploaded,
    photo_too_old: DC.photo_too_old,
    problem_open: DC.problem_open,
    wrong_side: DC.wrong_side,
  },
  declutter_answer_no_show: {
    account_restricted: DC.account_restricted,
    note_required: DC.note_required,
    photo_not_uploaded: DC.photo_not_uploaded,
    problem_already_open: DC.problem_already_open,
    too_many_photos: "Add up to 3 photos.",
    item_not_found: DC.item_not_found,
    no_show_answer_late: DC.no_show_answer_late,
    no_show_not_reported: DC.no_show_not_reported,
    not_authenticated: DC.not_authenticated,
    order_not_paid: DC.order_not_paid,
    wrong_side: DC.wrong_side,
  },
  declutter_cancel_after_no_helpr: {
    // BUY-36 (20261031231150): reached through the steps it runs (the close, the confirm, the debt take, the lock).
    invalid_payout: DC.invalid_payout,
    account_restricted: DC.account_restricted,
    already_paid_out: DC.already_paid_out,
    // From the close (declutter_close_paid_order): the task of an order no Helpr took is already closed, so these
    // three are not reached; if one is, the sale is not one this cancel can close.
    delivery_not_done: DC.not_a_no_helpr_order,
    invalid_method: DC.not_a_no_helpr_order,
    invalid_status: DC.not_a_no_helpr_order,
    order_not_paid: DC.order_not_paid,
    refund_amount_unknown: DC.refund_amount_unknown,
    item_not_found: DC.item_not_found,
    not_a_no_helpr_order: DC.not_a_no_helpr_order,
    not_authenticated: DC.not_authenticated,
    pickup_booked: DC.pickup_booked,
    problem_open: DC.problem_open,
    wrong_side: "Only the buyer can cancel this sale.",
  },
  declutter_report_helpr_no_show: {
    account_restricted: DC.account_restricted,
    already_handed_over: DC.already_handed_over,
    item_not_found: DC.item_not_found,
    no_helpr_booked: DC.no_helpr_booked,
    not_a_helpr_delivery: DC.not_a_helpr_delivery,
    not_authenticated: DC.not_authenticated,
    problem_open: DC.problem_open,
    too_early: "You can report this 15 minutes after the pickup time.",
    wrong_side: "Only the seller reports this.",
  },
  declutter_helpr_answer_no_show: {
    account_restricted: DC.account_restricted,
    already_answered: DC.already_answered,
    item_not_found: DC.item_not_found,
    no_show_answer_late: DC.no_show_answer_late,
    no_show_not_reported: "The seller hasn't reported anything on this delivery.",
    not_authenticated: DC.not_authenticated,
    note_required: DC.note_required,
    photo_not_uploaded: DC.photo_not_uploaded,
    task_not_found: DC.task_not_found,
  },
  declutter_report_no_show: {
    // BUY-36 (20261031231150): reached through the steps it runs (the close, the confirm, the debt take, the lock).
    invalid_payout: DC.invalid_payout,
    account_restricted: DC.account_restricted,
    problem_taken_back: DC.problem_taken_back,
    already_confirmed: DC.already_confirmed,
    no_show_reported: DC.no_show_reported,
    seller_confirmed: DC.seller_confirmed,
    already_paid_out: DC.already_paid_out,
    already_picked_up: DC.already_picked_up,
    delivery_not_done: DC.delivery_not_done,
    invalid_method: DC.invalid_method,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    not_booked_yet: DC.not_booked_yet,
    order_not_paid: DC.order_not_paid,
    problem_open: DC.problem_open,
    refund_amount_unknown: DC.refund_amount_unknown,
    seller_set_out: DC.seller_set_out,
    too_early: DC.too_early,
  },
  declutter_report_problem: {
    account_restricted: DC.account_restricted,
    invalid_reason: DC.invalid_reason,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    note_required: DC.note_required,
    order_not_paid: DC.order_not_paid,
    photo_not_uploaded: DC.photo_not_uploaded,
    // D2-3 (20261029225634): a second report is refused, never dropped.
    problem_already_open: DC.problem_already_open,
    problem_already_reported: DC.problem_already_reported,
    // B100 (20261030134109): the member who took back their report on this sale.
    problem_taken_back: DC.problem_taken_back,
    sale_final: DC.sale_final,
    too_many_photos: DC.too_many_photos,
  },
  // B100 (20261030134109): the reporter takes back an open problem until Louisiana Helpr decides.
  declutter_withdraw_problem: {
    account_restricted: DC.account_restricted,
    // declutter_lock_order: the order behind the problem is gone.
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    problem_already_decided: DC.problem_already_decided,
    problem_has_refund_request: DC.problem_has_refund_request,
    problem_has_return: DC.problem_has_return,
    problem_not_found: DC.problem_not_found,
  },
  // D2-3 (20261029225634): the other side adds theirs to an open problem.
  declutter_problem_add_side: {
    account_restricted: DC.account_restricted,
    // declutter_lock_order: the order behind the problem is gone.
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    note_required: DC.note_required,
    photo_not_uploaded: DC.photo_not_uploaded,
    problem_already_decided: DC.problem_already_decided,
    problem_not_found: DC.problem_not_found,
    problem_side_is_yours: DC.problem_side_is_yours,
    too_many_problem_photos: DC.too_many_problem_photos,
  },
  // Audit 1030 DB-1 (20261030044444): the order card's problem read (the two sides and admins).
  declutter_order_problem: {
    not_authenticated: DC.not_authenticated,
    problem_not_found: DC.problem_not_found,
  },
  // Board 141, Declutter side (20261026155251): a refund request after the handover.
  declutter_refund_request_view: {
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_ask_refund: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    invalid_reason: DC.invalid_reason,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    note_required: DC.note_required,
    photo_not_uploaded: DC.photo_not_uploaded,
    problem_open: DC.problem_open,
    refund_already_asked: DC.refund_already_asked,
    refund_before_handover: DC.refund_before_handover,
    refund_window_over: DC.refund_window_over,
    too_many_problem_photos: DC.too_many_problem_photos,
  },
  declutter_answer_refund: {
    account_restricted: DC.account_restricted,
    already_refunded: DC.already_refunded,
    invalid_payout: DC.invalid_payout,
    invalid_reason: DC.invalid_reason,
    order_not_handed_over: DC.order_not_handed_over,
    payout_missing: DC.payout_missing,
    refund_amount_unknown: DC.refund_amount_unknown,
    feature_disabled: DC.feature_disabled,
    invalid_amount: DC.invalid_amount,
    invalid_answer: DC.invalid_answer,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    part_refund_unavailable: DC.part_refund_unavailable,
    payout_already_sent: DC.payout_already_sent,
    refund_already_answered: DC.refund_already_answered,
    refund_answer_late: DC.refund_answer_late,
    refund_not_found: DC.refund_not_found,
  },
  declutter_answer_refund_offer: {
    account_restricted: DC.account_restricted,
    already_refunded: DC.already_refunded,
    feature_disabled: DC.feature_disabled,
    invalid_amount: DC.invalid_amount,
    invalid_answer: DC.invalid_answer,
    invalid_payout: DC.invalid_payout,
    invalid_reason: DC.invalid_reason,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    order_not_handed_over: DC.order_not_handed_over,
    part_refund_unavailable: DC.part_refund_unavailable,
    payout_already_sent: DC.payout_already_sent,
    payout_missing: DC.payout_missing,
    refund_already_answered: DC.refund_already_answered,
    refund_amount_unknown: DC.refund_amount_unknown,
    refund_answer_late: DC.refund_answer_late,
    refund_not_found: DC.refund_not_found,
  },
  declutter_withdraw_refund: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    refund_already_answered: DC.refund_already_answered,
    refund_not_found: DC.refund_not_found,
  },  declutter_refund_item_returned: {
    account_restricted: DC.account_restricted,
    already_refunded: DC.already_refunded,
    feature_disabled: DC.feature_disabled,
    invalid_amount: DC.invalid_amount,
    invalid_payout: DC.invalid_payout,
    invalid_reason: DC.invalid_reason,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    order_not_handed_over: DC.order_not_handed_over,
    part_refund_unavailable: DC.part_refund_unavailable,
    payout_already_sent: DC.payout_already_sent,
    payout_missing: DC.payout_missing,
    photo_not_uploaded: DC.photo_not_uploaded,
    photo_too_old: DC.photo_too_old,
    refund_already_answered: DC.refund_already_answered,
    refund_amount_unknown: DC.refund_amount_unknown,
    refund_not_found: DC.refund_not_found,
  },
  // Declutter returns (20261030071818_declutter_returns.sql).
  declutter_accept_refund_with_return: {
    account_restricted: DC.account_restricted,
    drop_off_not_offered: DC.drop_off_not_offered,
    no_return_needed: DC.no_return_needed,
    feature_disabled: DC.feature_disabled,
    invalid_return_day: DC.invalid_return_day,
    invalid_return_time: DC.invalid_return_time,
    invalid_return_way: DC.invalid_return_way,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    payout_already_sent: DC.payout_already_sent,
    refund_already_answered: DC.refund_already_answered,
    refund_answer_late: DC.refund_answer_late,
    refund_not_found: DC.refund_not_found,
  },
  declutter_return_dropped_off: {
    account_restricted: DC.account_restricted,
    before_return_day: DC.before_return_day,
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    location_required: DC.location_required,
    not_a_drop_off: DC.not_a_drop_off,
    not_at_pickup: DC.not_at_pickup,
    not_authenticated: DC.not_authenticated,
    photo_not_uploaded: DC.photo_not_uploaded,
    photo_too_old: DC.photo_too_old,
    refund_not_found: DC.refund_not_found,
  },
  declutter_set_return_address: {
    account_restricted: DC.account_restricted,
    address_not_found: DC.address_not_found,
    address_required: DC.address_required,
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_a_collect: DC.not_a_collect,
    not_authenticated: DC.not_authenticated,
    refund_not_found: DC.refund_not_found,
  },

  declutter_set_porch_time: {
    account_restricted: DC.account_restricted,
    invalid_porch_time: DC.invalid_porch_time,
    item_not_found: DC.item_not_found,
    not_a_porch_pickup: DC.not_a_porch_pickup,
    not_booked_yet: DC.not_booked_yet,
  },
  declutter_add_item_photo: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    photo_not_uploaded: DC.photo_not_uploaded,
    too_many_photos: DC.too_many_photos,
    under_18: DC.under_18,
  },
  declutter_answer_question: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    question_not_found: DC.question_not_found,
    under_18: DC.under_18,
  },
  // Q2278: the item page's questions read (20261021122157); the switch is its only refusal.
  declutter_item_questions: {
    feature_disabled: DC.feature_disabled,
  },
  // AUD31-15: the caller's own question ids on an item (20261031183631); the switch is its only refusal.
  declutter_my_question_ids: {
    feature_disabled: DC.feature_disabled,
  },
  declutter_ask_question: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    own_item: DC.own_item,
    question_rate_limited: DC.question_rate_limited,
    under_18: DC.under_18,
  },
  declutter_attest_item: {
    account_restricted: DC.account_restricted,
    attestation_incomplete: DC.attestation_incomplete,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_buy_now: {
    account_restricted: DC.account_restricted,
    card_required: DC.card_required,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    free_item_claim_it: DC.free_item_claim_it,
    item_not_available: DC.item_not_available,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    offer_not_open: DC.offer_not_open,
    own_item: DC.own_item,
    price_changed: DC.price_changed,
    sale_mode_unavailable: DC.sale_mode_unavailable,
    under_18: DC.under_18,
  },
  // The Free section (20261027170717): claim a free item, and finish an all-free cart.
  // The Free change (Q2487, 20261030064021): ask for a free item; the giver picks. (declutter_claim_free, still called by
  // installed builds, now asks through declutter_request_free.)
  declutter_request_free: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    free_claim_limit: DC.free_claim_limit,
    free_paused: DC.free_paused,
    item_not_available: DC.item_not_available,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    not_free: DC.not_free,
    own_item: DC.own_item,
    sale_mode_unavailable: DC.sale_mode_unavailable,
    under_18: DC.under_18,
  },
  // Owner 11-01 (20261101174857): the ask carries the pickup time the asker picked.
  declutter_request_free_at: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    free_claim_limit: DC.free_claim_limit,
    free_paused: DC.free_paused,
    item_not_available: DC.item_not_available,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    not_free: DC.not_free,
    own_item: DC.own_item,
    pickup_time_unavailable: DC.pickup_time_unavailable,
    sale_mode_unavailable: DC.sale_mode_unavailable,
    under_18: DC.under_18,
  },
  declutter_withdraw_free_request: {
    not_authenticated: DC.not_authenticated,
    request_not_found: DC.request_not_found,
  },
  declutter_free_requests_for_item: {
    item_not_found: DC.item_not_found,
  },
  declutter_pick_free_request: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    item_not_available: DC.item_not_available,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    offer_not_open: DC.offer_not_open,
    request_not_found: DC.request_not_found,
    request_not_open: DC.request_not_open,
    requester_unavailable: DC.requester_unavailable,
    under_18: DC.under_18,
  },
  declutter_checkout_free: {
    // declutter_free_claim_gate (20261031211922), behind identity_check.
    identity_required_to_claim: DC.identity_required_to_claim,
    setup_fee_required_to_claim: DC.setup_fee_required_to_claim,
    account_restricted: DC.account_restricted,
    cart_empty: DC.cart_empty,
    checkout_page_open: DC.checkout_page_open,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    handover_unavailable: DC.handover_unavailable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    not_free_order: DC.not_free_order,
    porch_unavailable: DC.porch_unavailable,
    // Owner 2026-10-28 (20261028235247): a way the giver did not tick.
    handover_not_offered: DC.handover_not_offered,
    // D-NEW14 (20261030164712): a giver with saved porch places, and no place picked yet.
    porch_place_needed: DC.porch_place_needed,
    under_18: DC.under_18,
  },
  // Owner 2026-10-28: the ways the seller ticks on step 4 (20261028235247).
  // LEAD-DELIVER-OFF-ALL (20261031180550): what declutter_assert_member, the switch and the ban check raise.
  declutter_stop_my_seller_delivery: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_set_handovers: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_handovers: DC.invalid_handovers,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  // Owner 2026-10-28 (Q2462, 20261028235249): the handover chat, and the seller adding a way to a listed item.
  declutter_open_handover_talk: {
    account_restricted: DC.account_restricted,
    talk_blocked: DC.talk_blocked,
    feature_disabled: DC.feature_disabled,
    handover_way_open: DC.handover_way_open,
    no_agreed_sale: DC.no_agreed_sale,
    not_authenticated: DC.not_authenticated,
    talk_recently_closed: DC.talk_recently_closed,
  },
  declutter_send_handover_message: {
    account_restricted: DC.account_restricted,
    talk_blocked: DC.talk_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_message: DC.invalid_message,
    message_rate_limited: DC.message_rate_limited,
    not_authenticated: DC.not_authenticated,
    talk_closed: DC.talk_closed,
    talk_not_found: DC.talk_not_found,
  },
  // The paid-order chat (20261030004216, D2-1). No switch gate: a paid sale carries on with Declutter off.
  declutter_my_order_talks: {
    not_authenticated: DC.not_authenticated,
  },
  declutter_order_talk_view: {
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    order_not_paid: DC.order_not_paid,
  },
  // The delivery chat (BUY-36, 20261031231948).
  helpr_task_talk_view: {
    not_authenticated: DC.not_authenticated,
    task_not_found: "We couldn't find that delivery.",
  },
  helpr_task_send_message: {
    // BUY-36 (20261031231150): reached through the steps it runs (the close, the confirm, the debt take, the lock).
    item_not_found: DC.item_not_found,
    account_restricted: DC.account_restricted,
    invalid_message: DC.invalid_message,
    message_rate_limited: DC.message_rate_limited,
    not_authenticated: DC.not_authenticated,
    talk_blocked: DC.talk_blocked,
    talk_closed: DC.talk_closed,
    task_not_found: "We couldn't find that delivery.",
  },
  declutter_send_order_message: {
    account_restricted: DC.account_restricted,
    invalid_message: DC.invalid_message,
    item_not_found: DC.item_not_found,
    message_rate_limited: DC.message_rate_limited,
    not_authenticated: DC.not_authenticated,
    order_not_paid: DC.order_not_paid,
    talk_blocked: DC.talk_blocked,
    talk_closed: DC.talk_closed,
  },
  declutter_add_handover: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_handovers: DC.invalid_handovers,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  // Wanted posts + fair-price hint (20261016053541).
  declutter_close_wanted: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    wanted_not_found: DC.wanted_not_found,
  },
  // Audit 10-30 #9, #12: edit, post again, remove, and which listings can answer.
  declutter_update_wanted: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_category: DC.invalid_category,
    invalid_max_price: DC.invalid_max_price,
    invalid_radius: DC.invalid_radius,
    invalid_wanted_text: DC.invalid_wanted_text,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
    wanted_not_found: DC.wanted_not_found,
    wanted_not_open: DC.wanted_not_open,
  },
  declutter_reopen_wanted: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
    wanted_not_found: DC.wanted_not_found,
    wanted_open_limit: DC.wanted_open_limit,
  },
  declutter_remove_wanted: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    wanted_not_found: DC.wanted_not_found,
  },
  declutter_block_wanted_poster: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    wanted_not_found: DC.wanted_not_found,
    wanted_block_shared_job: DC.wanted_block_shared_job,
  },
  declutter_my_reply_listings: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
    wanted_not_found: DC.wanted_not_found,
  },
  // Wanted photos (20261030064727, owner 2026-10-30).
  declutter_add_wanted_photo: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    photo_not_uploaded: DC.photo_not_uploaded,
    under_18: DC.under_18,
    wanted_not_found: DC.wanted_not_found,
    wanted_not_open: DC.wanted_not_open,
    wanted_too_many_photos: DC.wanted_too_many_photos,
  },
  declutter_remove_wanted_photo: {
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    wanted_not_found: DC.wanted_not_found,
  },
  declutter_create_wanted: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_category: DC.invalid_category,
    invalid_max_price: DC.invalid_max_price,
    invalid_radius: DC.invalid_radius,
    invalid_wanted_text: DC.invalid_wanted_text,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
    wanted_area_unknown: DC.wanted_area_unknown,
    wanted_open_limit: DC.wanted_open_limit,
    wanted_rate_limited: DC.wanted_rate_limited,
  },
  declutter_wanted_browse: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
    wanted_area_unknown: DC.wanted_area_unknown,
  },
  declutter_wanted_reply: {
    account_restricted: DC.account_restricted,
    already_replied: DC.already_replied,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_reply_amount: DC.invalid_reply_amount,
    item_not_available: DC.item_not_available,
    item_not_found: DC.item_not_found,
    listing_has_open_offer: DC.listing_has_open_offer,
    listing_too_far: DC.listing_too_far,
    not_authenticated: DC.not_authenticated,
    reply_rate_limited: DC.reply_rate_limited,
    under_18: DC.under_18,
    wanted_busy: DC.wanted_busy,
    wanted_not_found: DC.wanted_not_found,
  },
  declutter_my_wanted: {
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
  },
  declutter_price_hint: {
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
  },
  // The Browse map's pins (20261028151144): a rough area, never the seller's house.
  declutter_map_pins: {
    declutter_pin_secret_missing: "We couldn't load the map. Try again in a moment.",
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
  },
  declutter_create_item: {
    account_restricted: DC.account_restricted,
    area_looks_like_address: DC.area_looks_like_address,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_floor_price: DC.invalid_floor_price,
    invalid_location: DC.invalid_location,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  // LEAD-POST-SLOW (a), 20261031160546: the same rules with the id the app picked at the first photo. item_id_taken
  // never reaches the seller: createDraft reuses the seller's own draft, says "Already posted" for the seller's own
  // posted item (LEAD-RESUME-REPOSTS), and only for an id that isn't the seller's makes a fresh one.
  declutter_create_item_with_id: {
    account_restricted: DC.account_restricted,
    area_looks_like_address: DC.area_looks_like_address,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_floor_price: DC.invalid_floor_price,
    invalid_location: DC.invalid_location,
    item_id_taken: "Something went wrong saving your listing. Tap Post it again.",
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_create_move_drafts: {
    account_restricted: DC.account_restricted,
    area_looks_like_address: DC.area_looks_like_address,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_floor_price: DC.invalid_floor_price,
    invalid_items: DC.invalid_items,
    invalid_location: DC.invalid_location,
    invalid_move_out_date: DC.invalid_move_out_date,
    item_not_found: DC.item_not_found,
    move_draft_limit: DC.move_draft_limit,
    not_authenticated: DC.not_authenticated,
    too_many_items: DC.too_many_items,
    under_18: DC.under_18,
  },
  declutter_make_offer: {
    account_restricted: DC.account_restricted,
    card_required: DC.card_required,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_offer_amount: DC.invalid_offer_amount,
    item_not_available: DC.item_not_available,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    offer_already_open: DC.offer_already_open,
    // An offer at or above the seller's lowest price is accepted at once (declutter_take_item), which can find it closed.
    offer_not_open: DC.offer_not_open,
    offer_rate_limited: DC.offer_rate_limited,
    offer_too_low: DC.offer_too_low,
    offers_off: DC.offers_off,
    other_side_unavailable: DC.other_side_unavailable,
    own_item: DC.own_item,
    sale_mode_unavailable: DC.sale_mode_unavailable,
    under_18: DC.under_18,
  },
  declutter_my_cart: {
    not_authenticated: DC.not_authenticated,
  },
  declutter_link_setup_job: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    job_already_funded: DC.job_already_funded,
    not_authenticated: DC.not_authenticated,
  },
  declutter_my_item_review: {
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
  },
  declutter_my_move_out_date: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
  },
  declutter_my_offers: {
    not_authenticated: DC.not_authenticated,
  },
  // Audit 1028 D1-1 (20261029205908): editing a live listing.
  declutter_edit_listing: {
    account_restricted: DC.account_restricted,
    attestation_required: DC.attestation_required,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_handovers: DC.invalid_handovers,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_publish_item: {
    account_restricted: DC.account_restricted,
    attestation_required: DC.attestation_required,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_floor_price: DC.invalid_floor_price,
    item_not_a_draft: DC.item_not_a_draft,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    photos_required: DC.photos_required,
    pickup_windows_required: DC.pickup_windows_required,
    sale_mode_unavailable: DC.sale_mode_unavailable,
    under_18: DC.under_18,
  },
  // LEAD-LIST-FOR-SELLER (20261101034159).
  declutter_approve_listed_for_me: {
    // Each listing's own refusal comes back in its row (the per-listing block catches it), in these words.
    attestation_incomplete: DC.attestation_incomplete,
    attestation_required: DC.attestation_required,
    invalid_floor_price: DC.invalid_floor_price,
    item_not_a_draft: DC.item_not_a_draft,
    item_not_found: DC.item_not_found,
    photos_required: DC.photos_required,
    pickup_windows_required: DC.pickup_windows_required,
    sale_mode_unavailable: DC.sale_mode_unavailable,
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_items: DC.invalid_items,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  // LEAD-LIST-FOR-SELLER (20261101034159).
  declutter_decline_listed_for_me: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
  },
  // LEAD-LIST-FOR-SELLER (20261101034159).
  declutter_helpr_add_listing_photo: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    item_not_a_draft: DC.item_not_a_draft,
    item_not_found: DC.item_not_found,
    job_not_open: "This job is closed, so its listings can't be changed.",
    not_your_job: "Only the Helpr hired for this job can write its listings.",
    photo_not_uploaded: DC.photo_not_uploaded,
    too_many_photos: DC.too_many_photos,
  },
  // LEAD-LIST-FOR-SELLER (20261101034159).
  declutter_helpr_create_listing: {
    account_restricted: DC.account_restricted,
    area_looks_like_address: DC.area_looks_like_address,
    feature_disabled: DC.feature_disabled,
    invalid_floor_price: DC.invalid_floor_price,
    invalid_location: DC.invalid_location,
    job_not_open: "This job is closed, so its listings can't be changed.",
    not_authenticated: DC.not_authenticated,
    not_your_job: "Only the Helpr hired for this job can write its listings.",
  },
  // LEAD-LIST-FOR-SELLER (20261101034159).
  declutter_helpr_delete_listing: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    item_not_a_draft: DC.item_not_a_draft,
    item_not_found: DC.item_not_found,
    job_not_open: "This job is closed, so its listings can't be changed.",
    not_your_job: "Only the Helpr hired for this job can write its listings.",
  },
  // LEAD-LIST-FOR-SELLER (20261101034159).
  declutter_helpr_job_listings: {
    feature_disabled: DC.feature_disabled,
    not_your_job: "Only the Helpr hired for this job can write its listings.",
  },
  // LEAD-LIST-FOR-SELLER (20261101034159): the Helpr edits an unsent draft.
  declutter_helpr_update_listing: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    invalid_floor_price: DC.invalid_floor_price,
    item_not_a_draft: DC.item_not_a_draft,
    item_not_found: DC.item_not_found,
    job_not_open: "This job is closed, so its listings can't be changed.",
    not_your_job: "Only the Helpr hired for this job can write its listings.",
  },
  // LEAD-LIST-FOR-SELLER (20261101034159).
  declutter_helpr_send_listings: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    job_not_open: "This job is closed, so its listings can't be changed.",
    not_your_job: "Only the Helpr hired for this job can write its listings.",
    nothing_to_send: "Add a listing first, then send it to the seller.",
    photos_required: DC.photos_required,
  },
  // LEAD-LIST-FOR-SELLER (20261101034159).
  declutter_listed_for_me: {
    feature_disabled: DC.feature_disabled,
  },
  declutter_remove_item_photo: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    photo_not_found: DC.photo_not_found,
    // DC-8 (20261030061927): the last photo of a listing on sale stays.
    too_few_photos: DC.too_few_photos,
    under_18: DC.under_18,
  },
  declutter_respond_offer: {
    offers_off: DC.offers_off,
    account_restricted: DC.account_restricted,
    card_required: DC.card_required,
    counter_same_amount: DC.counter_same_amount,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_action: DC.invalid_action,
    invalid_offer_amount: DC.invalid_offer_amount,
    item_not_available: DC.item_not_available,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    not_your_turn: DC.not_your_turn,
    offer_expired: DC.offer_expired,
    offer_not_found: DC.offer_not_found,
    offer_not_open: DC.offer_not_open,
    offer_too_low: DC.offer_too_low,
    other_side_unavailable: DC.other_side_unavailable,
    under_18: DC.under_18,
  },
  declutter_my_handover: {
    item_not_found: DC.item_not_found,
  },
  declutter_listing_manage_state: {
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_pause_listing: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_relist_listing: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    pickup_windows_required: DC.pickup_windows_required,
    under_18: DC.under_18,
  },
  // 20261028180400: a taken-down listing back to a draft (owner 2026-10-28).
  // A2-8 (20261028221904): the buyer takes an item out of their cart.
  declutter_remove_cart_item: {
    checkout_open: DC.checkout_open,
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    not_in_cart: DC.not_in_cart,
  },
  declutter_reopen_listing: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_seller_item_private: {
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
  },
  declutter_seller_moving_sale: {
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
  },
  declutter_set_auto_free_days: {
    account_restricted: DC.account_restricted,
    already_free: "This item is already free.",
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_choice: "Pick Never, 7, 14, 21 or 30 days.",
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_auto_free_days_state: {
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_set_keep_up: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_choice: "Something went wrong. Try again.",
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_keep_up_state: {
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_set_listing_drops: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_input: DC.invalid_input,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_set_listing_price: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_floor_price: DC.invalid_floor_price,
    invalid_price: DC.invalid_price,
    item_not_editable: DC.item_not_editable,
    price_above_listed: DC.price_above_listed,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_set_offer_rules: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_offer_rules: DC.invalid_offer_rules,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_set_move_out_date: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_move_out_date: DC.invalid_move_out_date,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_my_moving_sale: {
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
  },
  declutter_set_moving_sale: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_sale_dates: DC.invalid_sale_dates,
    invalid_sale_name: DC.invalid_sale_name,
    no_moving_sale: DC.no_moving_sale,
    not_authenticated: DC.not_authenticated,
    sale_name_contact_info: DC.sale_name_contact_info,
    under_18: DC.under_18,
  },
  declutter_set_pickup_windows: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_pickup_windows: DC.invalid_pickup_windows,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  // Owner 2026-10-28: the seller's nightly price-drop step (20261028160637).
  declutter_set_drop_pct: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_drop_pct: DC.invalid_drop_pct,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  // The seller's porch weekdays (20261029161347).
  declutter_my_porch_days: {
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
  },
  declutter_set_porch_days: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    invalid_porch_days: DC.invalid_porch_days,
    not_authenticated: DC.not_authenticated,
  },
  // D-NEW14 porch places (20261030164712).
  declutter_my_porch_places: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_save_porch_place: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_place_hours: DC.invalid_place_hours,
    invalid_porch_days: DC.invalid_porch_days,
    invalid_porch_place: DC.invalid_porch_place,
    not_authenticated: DC.not_authenticated,
    porch_place_not_found: DC.porch_place_not_found,
    porch_places_full: DC.porch_places_full,
    under_18: DC.under_18,
  },
  declutter_delete_porch_place: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    porch_place_not_found: DC.porch_place_not_found,
    under_18: DC.under_18,
  },
  declutter_seller_porch_places: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_set_porch_place: {
    account_restricted: DC.account_restricted,
    cart_empty: DC.cart_empty,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    porch_place_unavailable: DC.porch_place_unavailable,
    under_18: DC.under_18,
  },
  declutter_order_place: {
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_set_porch_ok: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_porch_choice: DC.invalid_porch_choice,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_set_watch: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    own_item: DC.own_item,
    under_18: DC.under_18,
  },
  declutter_update_draft: {
    account_restricted: DC.account_restricted,
    area_looks_like_address: DC.area_looks_like_address,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_floor_price: DC.invalid_floor_price,
    invalid_location: DC.invalid_location,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_setup_helpr: {
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_withdraw_item: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  // A2-5 (20261028192719): "Mark sold elsewhere" keeps the listing as history.
  declutter_free_still_available: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_mark_sold_elsewhere: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  // Haul-away (20261017070827): its RPCs' words are HAUL_AWAY_RPC_ERROR_COPY in
  // src/lib/declutter/haulAwayErrors.ts, loaded only with the haul-away code (Q178).
  // "Suggest a category" (I1, migration 20261015051141).
  suggest_category: {
    account_restricted: "Your account can't send suggestions right now.",
    feature_disabled: "Suggesting a category isn't available yet.",
    invalid_area: "Something went wrong sending your suggestion. Please try again.",
    invalid_suggestion: "Use 2 to 40 letters, starting with a letter. No links or contact details.",
    not_authenticated: "Sign in to suggest a category.",
    rate_limited: "You've sent 5 suggestions today. Try again tomorrow.",
  },
  // Quotes on jobs (20261015091114_job_quotes.sql): the words live in
  // src/lib/quotes/errorCopy.ts (QUOTE_ERROR_COPY, exact against the
  // migration); each RPC maps exactly the codes it can raise. Read at each
  // call in src/lib/quotes/api.ts.
  book_accepted_quote: {
    account_restricted: QC.account_restricted,
    applicant_blocked: QC.applicant_blocked,
    feature_disabled: QC.feature_disabled,
    no_agreed_quote: QC.no_agreed_quote,
    not_authenticated: QC.not_authenticated,
    under_18: QC.under_18,
    unknown_request: QC.unknown_request,
  },
  cancel_quote_request: {
    account_restricted: QC.account_restricted,
    checkout_open: QC.checkout_open,
    feature_disabled: QC.feature_disabled,
    not_authenticated: QC.not_authenticated,
    request_booked: QC.request_booked,
    request_closed: QC.request_closed,
    under_18: QC.under_18,
    unknown_request: QC.unknown_request,
  },
  create_quote_request: {
    account_restricted: QC.account_restricted,
    feature_disabled: QC.feature_disabled,
    invalid_date: QC.invalid_date,
    invalid_window: QC.invalid_window,
    job_start_too_soon: QC.job_start_too_soon,
    not_authenticated: QC.not_authenticated,
    too_many_open_requests: QC.too_many_open_requests,
    under_18: QC.under_18,
  },
  get_my_job_quotes: {
    account_restricted: QC.account_restricted,
    feature_disabled: QC.feature_disabled,
    not_authenticated: QC.not_authenticated,
    under_18: QC.under_18,
  },
  get_my_quote_requests: {
    account_restricted: QC.account_restricted,
    feature_disabled: QC.feature_disabled,
    not_authenticated: QC.not_authenticated,
    under_18: QC.under_18,
  },
  get_quotes_for_request: {
    account_restricted: QC.account_restricted,
    feature_disabled: QC.feature_disabled,
    not_authenticated: QC.not_authenticated,
    under_18: QC.under_18,
    unknown_request: QC.unknown_request,
  },
  list_open_quote_requests: {
    account_restricted: QC.account_restricted,
    feature_disabled: QC.feature_disabled,
    not_authenticated: QC.not_authenticated,
    under_18: QC.under_18,
  },
  respond_to_job_quote: {
    account_restricted: QC.account_restricted,
    applicant_blocked: QC.applicant_blocked,
    feature_disabled: QC.feature_disabled,
    invalid_action: QC.invalid_action,
    job_start_too_soon: QC.job_start_too_soon,
    not_authenticated: QC.not_authenticated,
    not_your_turn: QC.not_your_turn,
    price_required: QC.price_required,
    quote_closed: QC.quote_closed,
    quote_expired: QC.quote_expired,
    quote_unavailable: QC.quote_unavailable,
    under_18: QC.under_18,
    unknown_quote: QC.unknown_quote,
  },
  submit_job_quote: {
    account_restricted: QC.account_restricted,
    already_quoted: QC.already_quoted,
    cannot_quote_own_request: QC.cannot_quote_own_request,
    feature_disabled: QC.feature_disabled,
    invalid_photo: QC.invalid_photo,
    not_authenticated: QC.not_authenticated,
    quotes_closed: QC.quotes_closed,
    rate_limited: QC.rate_limited,
    under_18: QC.under_18,
    unknown_request: QC.unknown_request,
  },
  switch_quote_request_to_set_price: {
    account_restricted: QC.account_restricted,
    feature_disabled: QC.feature_disabled,
    invalid_budget: QC.invalid_budget,
    not_authenticated: QC.not_authenticated,
    request_closed: QC.request_closed,
    under_18: QC.under_18,
    unknown_request: QC.unknown_request,
  },
  withdraw_job_quote: {
    account_restricted: QC.account_restricted,
    feature_disabled: QC.feature_disabled,
    not_authenticated: QC.not_authenticated,
    quote_closed: QC.quote_closed,
    under_18: QC.under_18,
    unknown_quote: QC.unknown_quote,
  },
  // Rentals S1 (20261017205605): the words live in src/lib/rentals/errorCopy.ts
  // (RENTALS_ERROR_COPY, exact against the migration, rentalsErrorCopy.test.ts);
  // each RPC maps exactly the codes it can raise (rpcErrorCopyCoverage).
  rentals_accept_invite: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    invite_not_found: RC.invite_not_found,
    not_authenticated: RC.not_authenticated,
    own_invite: RC.own_invite,
    under_18: RC.under_18,
  },
  rentals_add_unit: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    property_not_found: RC.property_not_found,
    too_many_units: RC.too_many_units,
    under_18: RC.under_18,
    unit_exists: RC.unit_exists,
  },
  // Saved homes (20261019185722): the heart on a Homes card.
  rentals_set_saved_home: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    listing_not_found: RC.listing_not_found,
    not_authenticated: RC.not_authenticated,
    own_listing: RC.own_listing,
    too_many_saved_homes: RC.too_many_saved_homes,
  },
  rentals_approve_request: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    request_not_found: RC.request_not_found,
    under_18: RC.under_18,
  },
  rentals_create_property: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    too_many_properties: RC.too_many_properties,
    under_18: RC.under_18,
  },
  rentals_decline_request: {
    account_restricted: RC.account_restricted,
    contact_info_not_allowed: RC.contact_info_not_allowed,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    reason_required: RC.reason_required,
    request_not_found: RC.request_not_found,
    too_long: RC.too_long,
    under_18: RC.under_18,
  },
  // Either side ends a tenancy, or the landlord cancels an unused invite (no
  // ban or age check: leaving only removes access).
  rentals_end_tenancy: {
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    tenancy_not_found: RC.tenancy_not_found,
  },
  rentals_file_request: {
    account_restricted: RC.account_restricted,
    bad_category: RC.bad_category,
    bad_description: RC.bad_description,
    bad_photo_path: RC.bad_photo_path,
    bad_urgency: RC.bad_urgency,
    contact_info_not_allowed: RC.contact_info_not_allowed,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    tenancy_not_found: RC.tenancy_not_found,
    too_long: RC.too_long,
    too_many_photos: RC.too_many_photos,
    too_many_requests: RC.too_many_requests,
    under_18: RC.under_18,
  },
  // Homes -> Rent listings (20261019043000).
  rentals_add_listing_photo: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    listing_not_editable: RC.listing_not_editable,
    listing_not_found: RC.listing_not_found,
    photo_already_attached: RC.photo_already_attached,
    photo_not_uploaded: RC.photo_not_uploaded,
    too_many_photos: "A listing can have up to 25 photos.",
  },
  rentals_remove_listing_photo: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    listing_not_found: RC.listing_not_found,
    too_few_photos: "A listing that is showing keeps at least 5 photos. Pause it first to remove more.",
    listing_not_editable: "This listing is sold or removed, so its photos stay as they are.",
  },
  rentals_save_listing: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    bad_listing: RC.bad_listing,
    identity_not_verified: RC.identity_not_verified,
    listing_not_editable: RC.listing_not_editable,
    listing_not_found: RC.listing_not_found,
    ownership_not_approved: "You can list this home once an admin has checked your ownership proof.",
    unit_already_listed: RC.unit_already_listed,
    unit_not_found: RC.unit_not_found,
    wording_flagged: RC.wording_flagged,
  },
  rentals_set_listing_status: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    bad_status: RC.bad_status,
    identity_not_verified: RC.identity_not_verified,
    listing_not_editable: RC.listing_not_editable,
    listing_not_found: RC.listing_not_found,
    ownership_not_approved: "You can list this home once an admin has checked your ownership proof.",
    too_few_photos: RC.too_few_photos,
    wording_flagged: RC.wording_flagged,
    listing_fee_not_ready: RC.listing_fee_not_ready,
    sale_wording_flagged: RC.sale_wording_flagged,
    listing_taken_down: "Louisiana Helpr removed an earlier listing for this home, so it can't go live again. Contact support if you think that was a mistake.",
  },
  rentals_save_sale_listing: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    bad_listing: "Check the listing: every box needs a valid answer (price, beds, baths).",
    identity_not_verified: RC.identity_not_verified,
    listing_not_editable: "This listing was sold or removed. Start a new one.",
    listing_not_found: RC.listing_not_found,
    ownership_not_approved: "You can list this home once an admin has checked your ownership proof.",
    property_already_listed: RC.property_already_listed,
    property_not_found: RC.property_not_found,
    sale_wording_flagged: RC.sale_wording_flagged,
  },
  rentals_invite_tenant: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    identity_not_verified: RC.identity_not_verified,
    not_authenticated: RC.not_authenticated,
    ownership_not_approved: RC.ownership_not_approved,
    too_many_open_invites: RC.too_many_open_invites,
    under_18: RC.under_18,
    unit_not_found: RC.unit_not_found,
  },
  rentals_set_auto_approve: {
    account_restricted: RC.account_restricted,
    bad_limit: RC.bad_limit,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    property_not_found: RC.property_not_found,
    under_18: RC.under_18,
  },
  // Homes rent tracker, pay direct (20261019073106).
  rentals_set_rent_plan: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    tenancy_not_found: RC.tenancy_not_found,
    bad_rent_plan: RC.bad_rent_plan,
  },
  rentals_add_rent_payment: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    tenancy_not_found: RC.tenancy_not_found,
    bad_rent_payment: RC.bad_rent_payment,
    payment_over_balance: RC.payment_over_balance,
  },
  rentals_decide_rent_payment: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    payment_not_found: RC.payment_not_found,
    payment_already_decided: RC.payment_already_decided,
    reason_required: "Write why (3 to 300 characters). Your tenant will see it.",
  },
  rentals_waive_rent_charge: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    charge_not_found: RC.charge_not_found,
  },
  rentals_correct_rent_payment: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    payment_not_found: RC.payment_not_found,
    payment_not_correctable: RC.payment_not_correctable,
    bad_rent_payment: RC.bad_rent_payment,
    reason_required: "Write why (3 to 300 characters). Your tenant will see it.",
  },
  rentals_dispute_rent_payment: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    payment_not_found: RC.payment_not_found,
    payment_not_disputable: RC.payment_not_disputable,
    reason_required: "Write why (3 to 300 characters). Your landlord will see it.",
  },
  // Homes deposit tracker, track only (20261019082216).
  rentals_set_deposit: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    tenancy_not_found: RC.tenancy_not_found,
    bad_deposit: RC.bad_deposit,
    deposit_settled: RC.deposit_settled,
    deposit_already_recorded: RC.deposit_already_recorded,
  },
  rentals_set_forwarding_address: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    tenancy_not_found: RC.tenancy_not_found,
    bad_address: RC.bad_address,
    deposit_settled: "This deposit was already settled, so the address can't change.",
  },
  rentals_settle_deposit: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    tenancy_not_found: RC.tenancy_not_found,
    deposit_not_found: RC.deposit_not_found,
    deposit_settled: RC.deposit_settled,
    tenancy_not_ended: RC.tenancy_not_ended,
    bad_settlement: RC.bad_settlement,
  },
  // Homes lease, our Louisiana template only (20261019110137).
  rentals_lease_save: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    tenancy_not_found: RC.tenancy_not_found,
    bad_lease_fields: RC.bad_lease_fields,
    lease_awaiting_signature: RC.lease_awaiting_signature,
  },
  rentals_lease_send: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    lease_not_found: RC.lease_not_found,
    lease_not_open: RC.lease_not_open,
    lease_changed: RC.lease_changed,
    lease_incomplete: RC.lease_incomplete,
    lease_consent_required: RC.lease_consent_required,
    lease_initials_required: RC.lease_initials_required,
    bad_signature: RC.bad_signature,
    bad_lease_fields: RC.bad_lease_fields,
  },
  rentals_lease_withdraw: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    lease_not_found: RC.lease_not_found,
    lease_not_open: RC.lease_not_open,
  },
  rentals_lease_discard: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    lease_not_found: RC.lease_not_found,
    lease_not_open: RC.lease_not_open,
  },
  rentals_lease_request_changes: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    lease_not_found: RC.lease_not_found,
    lease_not_open: RC.lease_not_open,
    bad_change_request: RC.bad_change_request,
  },
  rentals_lease_sign: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
    lease_not_found: RC.lease_not_found,
    lease_not_open: RC.lease_not_open,
    lease_consent_required: RC.lease_consent_required,
    lease_initials_required: RC.lease_initials_required,
    bad_signature: RC.bad_signature,
    lease_changed: RC.lease_changed,
  },
  rentals_submit_ownership_proof: {
    account_restricted: RC.account_restricted,
    already_approved: RC.already_approved,
    bad_proof_path: RC.bad_proof_path,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    property_not_found: RC.property_not_found,
    under_18: RC.under_18,
  },
  rentals_submit_landlord_id: {
    account_restricted: RC.account_restricted,
    already_verified: RC.already_verified,
    bad_id_path: RC.bad_id_path,
    feature_disabled: RC.feature_disabled,
    id_photo_missing: RC.id_photo_missing,
    not_authenticated: RC.not_authenticated,
    under_18: RC.under_18,
  },
  rentals_cancel_request_job: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    job_not_cancellable: RC.job_not_cancellable,
    not_authenticated: RC.not_authenticated,
    request_not_found: RC.request_not_found,
    // Raised inside poster_cancel_job, which rentals_cancel_request_job calls only after its own checks
    // (the caller's own open, never-funded job, row-locked); if one is ever reached the job moved under us.
    job_not_cancelled: RC.job_not_cancellable,
    job_not_found: RC.job_not_cancellable,
    not_authorized: RC.job_not_cancellable,
    not_cancellable: RC.job_not_cancellable,
  },
  rentals_confirm_visit: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    no_visit_proposed: RC.no_visit_proposed,
    not_authenticated: RC.not_authenticated,
    request_not_found: RC.request_not_found,
    under_18: RC.under_18,
    visit_time_changed: RC.visit_time_changed,
    visit_time_passed: RC.visit_time_passed,
    tenancy_not_found: RC.tenancy_not_found,
  },
  rentals_propose_visit: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    job_not_found: RC.job_not_found,
    not_authenticated: RC.not_authenticated,
    visit_time_invalid: RC.visit_time_invalid,
  },
  rentals_tenant_answer_fixed: {
    account_restricted: RC.account_restricted,
    answer_required: RC.answer_required,
    contact_info_not_allowed: RC.contact_info_not_allowed,
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    note_too_long: RC.note_too_long,
    request_not_found: RC.request_not_found,
    under_18: RC.under_18,
  },
  rentals_withdraw_request: {
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    request_not_found: RC.request_not_found,
  },
  // SMS alerts (20261021193738): SmsAlertsCard in Notification settings.
  set_sms_consent: {
    account_restricted: "Your account is restricted right now, so you can't turn on text alerts. You can still turn them off.",
    feature_disabled: "Text alerts aren't available on your account yet.",
    invalid_phone: "Enter a 10-digit US mobile number.",
    not_authenticated: "Sign in again to change text alerts.",
  },
  get_my_sms_consent: {
    not_authenticated: "Sign in again to see your text alert settings.",
  },
  // Q2423: the one-time "Add your phone" prompt (20261027183058). Its read fails quietly (no prompt) and its
  // dismiss is logged, so these words only reach a member through a shared error path.
  sms_phone_prompt_due: {
    invalid_moment: "We couldn't check your text alerts. Try again.",
    not_authenticated: "Sign in again to see your text alert settings.",
  },
  dismiss_sms_phone_prompt: {
    not_authenticated: "Sign in again to change your text alert settings.",
  },
} satisfies Record<string, Record<string, string>>;

export type MappedRpc = keyof typeof RPC_ERROR_COPY;
export type RpcErrorCode<R extends MappedRpc> = Extract<keyof (typeof RPC_ERROR_COPY)[R], string>;

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const m = (error as { message?: unknown } | null)?.message;
  return typeof m === "string" ? m : "";
}

/**
 * The code in `codes` that `error` names, or `null`. Matched as a whole token
 * so `not_authorized` never fires on a longer code that happens to contain it.
 * Shared with the admin console's table (adminRpcErrorCopy.ts) so both match
 * the same way.
 */
export function codeNamedIn<C extends string>(codes: Record<C, string>, error: unknown): C | null {
  const raw = rawMessage(error);
  if (!raw) return null;
  for (const code of Object.keys(codes) as C[]) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return code;
  }
  return null;
}

/** The code `rpc` raised, when it is one we have copy for; `null` otherwise. */
export function rpcErrorCode<R extends MappedRpc>(rpc: R, error: unknown): RpcErrorCode<R> | null {
  return codeNamedIn(RPC_ERROR_COPY[rpc] as Record<RpcErrorCode<R>, string>, error);
}

/**
 * Human copy for an error `rpc` returned, or `null` when it is not a code we
 * have wording for (so the caller keeps its own fallback).
 */
export function rpcErrorMessage(rpc: MappedRpc, error: unknown): string | null {
  const code = rpcErrorCode(rpc, error);
  return code ? (RPC_ERROR_COPY[rpc] as Record<string, string>)[code] : null;
}

/**
 * The admin console's RPC copy, fetched on demand by the few shared modules
 * that call an admin-only RPC (categorySuggestions, declutter/api,
 * declutter/handover, the team thread's send handler). The admin pages import
 * it statically; this keeps it out of every member's chunks. Resolves `null`
 * when the chunk cannot be fetched (offline, or a deploy replaced it): the
 * caller then shows its own fallback words, and the RPC error itself is still
 * thrown or reported exactly as before.
 */
export function loadAdminRpcErrorCopy(): Promise<typeof import("@/components/admin/adminRpcErrorCopy") | null> {
  return import("@/components/admin/adminRpcErrorCopy").catch(() => {
    // Not silent: the caller's own fallback copy is shown and the RPC error is
    // still thrown or reported; only the more specific sentence is lost.
    return null;
  });
}

/**
 * Codes that are a designed refusal rather than a defect: the user is shown the
 * copy above, and the caller does NOT report them to Sentry (a settlement in
 * progress is the lock working, not a bug — round-4 review, LOW).
 */
const EXPECTED_REFUSALS = ["dispute_settlement_in_progress"] as const;

export function isExpectedLifecycleRefusal(error: unknown): boolean {
  const raw =
    typeof error === "string"
      ? error
      : ((error as { message?: string } | null)?.message ?? "");
  return !!raw && EXPECTED_REFUSALS.some((code) => raw.includes(code));
}

/**
 * Map a Postgres/PostgREST error onto human copy, or `null` when the code is
 * not one we have specific wording for (so the caller keeps its own fallback).
 */
export function lifecycleErrorMessage(error: unknown): string | null {
  // A write that matched zero rows carries its own human sentence (see
  // mutationResult.ts). It never has a Postgres code to match on, so it has to
  // be handled before the code table.
  if (isWriteRejected(error)) return error.userMessage;

  // A non-string message (a thrown object carrying a number, say) has no code to match: null, never a throw.
  const message = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof message === "string" ? message : "";
  if (!raw) return null;
  for (const [code, copy] of Object.entries(LIFECYCLE_REASONS)) {
    // Postgres wraps the code in its own prose, so match on containment
    // rather than equality.
    if (raw.includes(code)) return copy;
  }
  return null;
}
