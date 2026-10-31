import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrors";
import { ADMIN_RPC_ERROR_COPY } from "@/components/admin/adminRpcErrorCopy";
import { HELPR_TASK_RPC_ERROR_COPY } from "@/lib/helprTasks/errorCopy";
import { SHOPS_RPC_ERROR_COPY } from "@/lib/shops/rpcErrorCopy";
import { HAUL_AWAY_RPC_ERROR_COPY } from "@/lib/declutter/haulAwayErrors";
import { REFUND_RPC_ERROR_COPY } from "@/lib/refundRequests/errorCopy";
import { SELLER_DELIVERY_RPC_ERROR_COPY } from "@/lib/declutter/sellerDeliveryErrors";
import { GUARANTEE_RPC_ERROR_COPY } from "@/lib/guarantee/errorCopy";
import { MEETUP_RPC_ERROR_COPY } from "@/lib/declutter/meetupErrors";
import { DONATE_RPC_ERROR_COPY } from "@/lib/declutter/donateErrors";
import { BUNDLE_RPC_ERROR_COPY } from "@/lib/declutter/bundleErrors";
import { PROFILE_RPC_ERROR_COPY } from "@/lib/declutter/profileErrors";
import {
  anonExecuteRevoked,
  clientRpcCalls,
  codesReachableFrom,
  findUnmapped,
  findUnwired,
  latestFunctionDefs,
  raisedCodes,
  type Allowlist,
  type CopyTable,
} from "./helpers/rpcErrorInventory";

// The inventory scans every migration and client file; under a loaded CI shard
// it has taken 33 s against the 20 s default. Give every test here 90 s.
vi.setConfig({ testTimeout: 90_000 });

/**
 * EVERY CODE A CLIENT-CALLED RPC CAN RAISE HAS WORDS AT THE PLACE IT IS CALLED.
 *
 * The bug this was built on (docs/OPEN.md, "Done is final", 2026-09-14): once
 * `open_dispute_as` started refusing completed jobs, a Helpr's Cancel job
 * (`helper_abort_job` → `rpc_open_dispute` → `open_dispute_as`) could come back
 * `job_already_completed`. ActiveJobSection only knew `not_abortable`, so the
 * person saw "We couldn't send that — check your connection and try again"
 * about a job that had just been marked complete. Nothing was broken; nothing
 * said so. The same shape sat at a dozen other call sites: an RPC grew a
 * guard, and the screen that calls it kept its generic toast.
 *
 * THE CHECK. Inventory from the world, minus what is covered, must be empty:
 *   - every `.rpc("X")` in non-test src/ (TypeScript AST),
 *   - X's latest migration definition and every function it calls,
 *   - each snake_case code those bodies RAISE,
 * must have copy in RPC_ERROR_COPY (src/lib/lifecycleErrors.ts) — or, for an
 * RPC only admins may call, in ADMIN_RPC_ERROR_COPY
 * (src/components/admin/adminRpcErrorCopy.ts) — or an entry below saying why no
 * client can reach it; every call site must read that copy through
 * rpcErrorMessage/rpcErrorCode; and nothing in any table may name a code the
 * RPC no longer raises.
 *
 * WHICH TABLE. An RPC whose latest definition checks `has_role(..., 'admin')`
 * keeps its copy in the admin table and never the shared one, and the admin
 * table holds nothing else: the shared table rides in a chunk every signed-in
 * first screen downloads (the /posts bundle budget,
 * scripts/perf/critical-path-budget.json), the admin one only in admin chunks.
 */

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

const ANON_REVOKED = "EXECUTE is revoked from anon, so a signed-out caller gets 42501 before the body runs; auth.uid() is never null inside it.";
const LADDER_AFTER_CANCEL =
  "raised by apply_cancellation_violation_consequence, which this RPC calls only after its own UPDATE set status = 'cancelled' on the row it holds FOR UPDATE, as the job's customer.";
const RENTALS_READ = "no message exists at this site: a failed Rentals read shows the screen's load-error state, not a code's words, and RentalsGate shows the 404 while the switch is off.";
const RENTALS_LINK = "no code's words at this site: useJobSubmit links the posted job best effort, reports any failure (useJobSubmit.linkMaintenance) and tells the landlord one fixed sentence, that the job posted but is not linked to the request (linkMaintenanceJobOrTell).";
const SILENT_PET_READ = "no message exists at this site: JobPetCareSheet's query error reports and hides the pet-care sheet, it shows no copy.";

/** Codes a client cannot reach from the place it calls the RPC. Each says why. */
const UNREACHABLE: Allowlist = {
  // OPS-5 (20261031220447): reportSignupSource (src/lib/signupSource.ts) runs in the background only once a member is
  // signed in (SessionManager, user id set); any error is report()ed and no message exists.
  record_my_signup_source: {
    not_signed_in: { reason: "no message exists at this site: reportSignupSource only runs signed in and only reports errors" },
  },
  // LEAD-POST-SLOW (a), 20261031160546: these make their item through declutter_create_item_with_id with a fresh
  // gen_random_uuid(), never an id from the caller, so its item_id_taken (an id already used) can't happen.
  declutter_create_item: {
    item_id_taken: { reason: "declutter_create_item passes gen_random_uuid() to declutter_create_item_with_id; a fresh v4 id never collides." },
  },
  declutter_create_move_drafts: {
    item_id_taken: { reason: "each draft is made by declutter_create_item, which passes gen_random_uuid(); a fresh v4 id never collides." },
  },
  // OPS-3 job drafts (20261030223154): saveDraftToAccount and clearDraftOnAccount (src/lib/jobPostDraftAccount.ts)
  // run in the background while typing and after posting. Any error goes to the console and the device keeps its copy; no message exists.
  save_my_job_post_draft: {
    not_authenticated: { reason: ANON_REVOKED },
    account_restricted: { reason: "no message exists at this site: saveDraftToAccount only logs; the device keeps the draft" },
    draft_too_large: { reason: "no message exists at this site: saveDraftToAccount only logs; the device keeps the draft" },
    invalid_draft: { reason: "no message exists at this site: saveDraftToAccount only logs; the device keeps the draft" },
  },
  clear_my_job_post_draft: {
    not_authenticated: { reason: ANON_REVOKED },
  },
  // B65 web push (20261030022344): saveWebPushSubscription and removeWebPushSubscription
  // (src/lib/webPush.ts) run in the background after sign-in and during sign-out. Any error is
  // reported (area push) and the caller goes on; neither ever shows a message.
  register_push_subscription: {
    not_signed_in: { reason: ANON_REVOKED },
    invalid_subscription: { reason: "no message exists at this site: saveWebPushSubscription reports any error (webPushRegister) and returns 'failed'; the browser's own PushSubscription supplies the endpoint and keys, and no copy is shown." },
  },
  unregister_push_subscription: {
    not_signed_in: { reason: ANON_REVOKED },
  },
  // B59 Book me (20261030013347): recordBookingSourceFor (src/lib/bookMe.ts) is best effort on
  // Post a job. A failure is reported and the post goes on; it never shows a message.
  record_booking_source: {
    not_signed_in: { reason: ANON_REVOKED },
    account_restricted: { reason: "no message exists at this site: recordBookingSourceFor reports any error and posting goes on; a restricted account is refused again, with words, by the post itself." },
  },
  // Boards 66/172 slice 2 (20261021130723): poster_cancel_job raises quote_changed only for a non-NULL
  // p_expected_fee_cents; rentals_cancel_request_job calls it with two arguments, so the check never runs there.
  rentals_cancel_request_job: {
    quote_changed: { reason: "unreachable: rentals_cancel_request_job calls poster_cancel_job(v_job, '...') with no p_expected_fee_cents, so the quote check is skipped (NULL)" },
  },
  // Board 191 (shell 1j): the admin funnel. The admin console is behind
  // AdminRoute, and the client only ever sends jobs/declutter and 7/30/90; any
  // error shows the card's own "Couldn't load the funnel" with Try again.
  admin_section_funnel: {
    not_authorized: { reason: "unreachable from the client: SectionFunnel mounts only inside the admin console (AdminRoute); any error shows the card's own failure state" },
    invalid_window: { reason: "unreachable from the client: SectionFunnel sends only 7, 30 or 90 days" },
    invalid_section: { reason: "unreachable from the client: SectionFunnel sends only 'jobs' or 'declutter'" },
  },
  // Boards 184 / 188 (Builder 2f s6): both hooks call only while their switch
  // reads on (useFeature gates `enabled`), and a refusal shows no words: the
  // reach line / proof line is simply left out (useJobReach drops 42501 quietly;
  // useApplicantCategoryCounts reports and returns null).
  get_job_match_reach: {
    feature_disabled: { reason: "no message exists at this site: useJobReach runs only while job_reach is on, and any error leaves the reach line out (a mid-session switch-off is expected and silent)." },
  },
  // Board 190 (builder2g s13): same shape. usePriceGuidance runs only while price_guidance is on, and any
  // error leaves the guidance card out (42501 quietly, anything else reported).
  get_price_guidance: {
    feature_disabled: { reason: "no message exists at this site: usePriceGuidance runs only while price_guidance is on, and any error leaves the card out (a mid-session switch-off is expected and silent)." },
  },
  get_applicant_category_counts: {
    feature_disabled: { reason: "no message exists at this site: useApplicantCategoryCounts runs only while applicant_proof is on, and any error leaves the proof line out." },
  },
  // Dispute settlement RPCs (20260915034822). These codes ARE user-reachable,
  // but their copy is rendered by each caller's own dispute-copy path, not the
  // central RPC_ERROR_COPY / rpcErrorMessage: DisputedSection + PostedJobActions
  // route through isExpectedLifecycleRefusal + helperDisputeCopy/posterDisputeControls,
  // and AdminDisputes renders in the admin console. dispute_settlement_in_progress
  // is an EXPECTED_REFUSAL. See lifecycleErrors.ts.
  rpc_withdraw_dispute: {
    dispute_settlement_in_progress: {
      reason: "Expected refusal rendered by DisputedSection/PostedJobActions via isExpectedLifecycleRefusal + their dispute-copy files, not central RPC_ERROR_COPY.",
    },
  },
  feature_switches_for_me: {
    too_many_keys: {
      reason: "nightly-red #2601: useFeature (its only caller) always sends FEATURE_SWITCH_KEYS, the registry of 14 keys, under the 64-key cap; and a failed read is not shown to the member, it reads every switch as off (fail closed).",
    },
  },
  rpc_admin_end_recurring_series: {
    end_series_unknown_kind: {
      reason: "Q417 (c): rpc_admin_end_recurring_series always passes the kind 'admin' to end_recurring_series_by_platform, so its unknown-kind refusal cannot be reached from this call site.",
    },
  },
  rpc_decide_dispute: {
    dispute_settlement_in_progress: {
      reason: "Admin console (AdminDisputes) renders the settlement-in-progress refusal in its own dispute UI, not via rpcErrorMessage.",
    },
    admin_is_party: {
      reason: "Admin-only guard: AdminDisputes gates the decide controls for an admin who is a party, and renders any raised code in its own admin dispute UI.",
    },
    dispute_job_charged_back: {
      reason: "Admin console: AdminDisputes' decide handler toasts lifecycleErrorMessage(err), whose table carries this code's sentence (Q342 review M1), not rpcErrorMessage.",
    },
    group_dispute_needs_crew_decision: {
      reason: "Admin-only (20260927012240, Q728): a crew is decided per member with rpc_decide_crew_dispute; AdminDisputes throws the raised error (message + hint) into its own admin dispute UI. Its per-member decision UI is open work in docs/OPEN.md Q728.",
    },
  },
  rpc_helper_mark_done: {
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
  },
  helper_abort_job: {
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
    reason_required: {
      reason: "ActiveJobSection disables Cancel job until abortReason.trim().length >= 5 and sends the trimmed text, so btrim(p_reason) is never empty.",
    },
  },
  block_user_and_settle: {
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
    job_not_found: { reason: LADDER_AFTER_CANCEL },
    not_authorized: { reason: `${LADDER_AFTER_CANCEL} The loop calls it only when customer_id = auth.uid().` },
    job_not_cancelled: { reason: `${LADDER_AFTER_CANCEL} It skips a row the UPDATE did not change.` },
  },
  // Calls block_user_and_settle, so it inherits these. Any settlement raises wanted_block_shared_job and rolls back.
  declutter_block_wanted_poster: {
    invalid_target: { reason: "the poster is never the caller (wanted_not_found first) and always a real id" },
    job_not_found: { reason: LADDER_AFTER_CANCEL },
    not_authorized: { reason: `${LADDER_AFTER_CANCEL} The loop calls it only when customer_id = auth.uid().` },
    job_not_cancelled: { reason: `${LADDER_AFTER_CANCEL} It skips a row the UPDATE did not change.` },
  },
  poster_cancel_job: {
    job_not_cancelled: { reason: LADDER_AFTER_CANCEL },
  },
  admin_reverse_violation: {
    reason_required: {
      reason: "UserAuditLog refuses to submit unless reason.trim() is non-empty and sends the trimmed text.",
    },
  },
  apply_low_rating_flag: {
    not_authenticated: { reason: `${ANON_REVOKED} The call is also fire-and-forget: CompletionPrompts only reports a failure.`, anonRevoked: true },
  },
  apply_message_violation_consequence: {
    not_authenticated: { reason: `${ANON_REVOKED} logViolation returns before calling without a user id.`, anonRevoked: true },
  },
  subscription_purchase_eligibility: {
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
    invalid_platform: { reason: "the only call (iap.ts assertMayPurchase) passes the literal p_platform: \"apple\"." },
  },
  get_job_pets: {
    job_not_found: { reason: SILENT_PET_READ },
    not_authorized: { reason: SILENT_PET_READ },
  },
  // Rentals S1 reads: a failed read shows the screen's own load-error state
  // (RentalsHomeView's error row, MaintenanceRequestView's <ErrorState>), never
  // a code's words; and RentalsGate renders the 404 while the switch is off, so
  // the queries only run for a caller the switch reaches.
  rentals_my_homes: {
    feature_disabled: { reason: RENTALS_READ },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
  },
  // Homes -> Rent listings (20261019043000): the browse list and the listing
  // page are reads; a failed read shows the load-error state, and the listing
  // page shows "This listing isn't available." for a listing the caller may not see.
  rentals_browse_listings: {
    feature_disabled: { reason: RENTALS_READ },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
  },
  // Homes -> Buy (20261019061241): the same read shape as the Rent browse.
  rentals_browse_sale_listings: {
    feature_disabled: { reason: RENTALS_READ },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
  },
  // Homes -> Saved (20261019185722): a read; a failed read shows the Saved list's load-error state.
  rentals_saved_listings: {
    feature_disabled: { reason: RENTALS_READ },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
  },
  rentals_listing: {
    feature_disabled: { reason: RENTALS_READ },
    listing_not_found: { reason: "no code's words at this site: ListingPage shows its own fixed 'This listing isn't available.' state for any failed read (a paused, expired or removed listing, or one the caller may not see)." },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
  },
  // Homes admin card list (20261019062540): HomesListingsCard renders inside Admin -> Settings only, which
  // the admin route gate keeps from non-admins; a failed load shows the card's own error state.
  rentals_admin_listings: {
    not_authorized: { reason: "no code's words at this site: the card lives on the admin-only Settings page; any failed load shows its fixed \"Couldn't load the listings.\" state." },
    bad_query: { reason: "no code's words at this site: the card's search box caps its input at 100 characters (maxLength), and any failed load shows the fixed \"Couldn't load the listings.\" state." },
  },
  // The ownership reviewer's take-down address flag (20261019062540, round 4 #2): read by RentalsOwnershipCard on the
  // admin-only Settings page, for at most the queue's properties; a failed read fails the queue's own load state.
  rentals_admin_takedown_matches: {
    not_authorized: { reason: "no code's words at this site: admin-only Settings page; a failed read shows the ownership queue's fixed load-error state." },
    too_many: { reason: "no code's words at this site: the client asks in chunks of at most 200 properties (fetchTakedownMatches), so the server cap is never reached." },
  },
  // Q2211: the owner's editor photo list (refs, no paths). A failed read leaves the Photos card on its
  // skeleton/load state; the editor itself is only reachable for the caller's own listing.
  rentals_my_listing_photos: {
    feature_disabled: { reason: RENTALS_READ },
    listing_not_found: { reason: "no code's words at this site: the Photos card sits inside the owner's own editor (fetchMyListing already found the listing), so a not-found here is a listing removed mid-edit; the card shows its load state, never the code." },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
  },
  rentals_request_job_state: {
    feature_disabled: { reason: RENTALS_READ },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
  },
  rentals_visit_for_job: {
    feature_disabled: { reason: RENTALS_READ },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
  },
  // Homes rent and deposit records (20261019073106, 20261019082216): reads; a failed read shows the panel's own
  // fixed load-error line ("Couldn't load the rent record." / "...the deposit record."), never a code's words.
  rentals_rent_ledger: {
    feature_disabled: { reason: RENTALS_READ },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
    tenancy_not_found: { reason: "no code's words at this site: the panel only renders for a tenancy the caller's own list returned; a not-found (ended or revoked meanwhile) shows the panel's fixed load-error line." },
  },
  rentals_deposit: {
    feature_disabled: { reason: RENTALS_READ },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
    tenancy_not_found: { reason: "no code's words at this site: the panel only renders for a tenancy the caller's own list returned; a not-found (ended or revoked meanwhile) shows the panel's fixed load-error line." },
  },
  rentals_my_ended_deposits: {
    feature_disabled: { reason: RENTALS_READ },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
  },
  // Homes lease reads (20261019110137): a failed read shows the panel's fixed "Couldn't load the lease." line,
  // or nothing for the Past leases list; PGRST202 (not deployed yet) reads as no lease.
  rentals_lease: {
    feature_disabled: { reason: RENTALS_READ },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
    tenancy_not_found: { reason: "no code's words at this site: the panel only renders for a tenancy the caller's own list returned; a not-found shows the panel's fixed load-error line." },
  },
  rentals_my_leases: {
    feature_disabled: { reason: RENTALS_READ },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
  },
  rentals_my_identity: {
    feature_disabled: { reason: RENTALS_READ },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
  },
  // Best effort after the job is posted (useJobSubmit): a refused link is
  // reported to the ops ledger and told as one fixed sentence; the job is posted either way.
  link_maintenance_request_job: {
    account_restricted: { reason: RENTALS_LINK },
    feature_disabled: { reason: RENTALS_LINK },
    not_authenticated: { reason: ANON_REVOKED, anonRevoked: true },
  },
};

const { calls, dynamic } = clientRpcCalls(ROOT);
const defs = latestFunctionDefs(MIGRATIONS);
const inventory = new Map<string, Map<string, string>>();
for (const rpc of calls.keys()) {
  const codes = codesReachableFrom(rpc, defs);
  if (codes.size) inventory.set(rpc, codes);
}
const SHARED = RPC_ERROR_COPY as CopyTable;
const ADMIN = ADMIN_RPC_ERROR_COPY as CopyTable;
/** Both tables: every rule below holds for an admin RPC's copy exactly as for a member's. */
// The helpr_* RPCs keep their words beside the delivery screens (src/lib/helprTasks/errorCopy.ts).
const HELPR = HELPR_TASK_RPC_ERROR_COPY as CopyTable;
const SHOPS = SHOPS_RPC_ERROR_COPY as CopyTable;
// Declutter haul-away's RPCs keep theirs in their own lazily loaded module (src/lib/declutter/haulAwayErrors.ts, Q178).
const HAUL = HAUL_AWAY_RPC_ERROR_COPY as CopyTable;
// Board 141's two refund-request RPCs keep theirs beside the refund dialogs (src/lib/refundRequests/errorCopy.ts, Q178).
const REFUND = REFUND_RPC_ERROR_COPY as CopyTable;
// Declutter seller delivery's, likewise (src/lib/declutter/sellerDeliveryErrors.ts, 20261027153244).
const SELLER_DELIVERY = SELLER_DELIVERY_RPC_ERROR_COPY as CopyTable;
// The Helpr Guarantee's four RPCs keep theirs beside the guarantee panel (src/lib/guarantee/errorCopy.ts, Q178).
const GUARANTEE = GUARANTEE_RPC_ERROR_COPY as CopyTable;
// Q2425 safe meetup spots, likewise (src/lib/declutter/meetupErrors.ts, 20261027204500).
const MEETUP = MEETUP_RPC_ERROR_COPY as CopyTable;
// Q2428 donate what doesn't sell, likewise (src/lib/declutter/donateErrors.ts, 20261027222743).
const DONATE = DONATE_RPC_ERROR_COPY as CopyTable;
// Q2427 bundle discounts, likewise (src/lib/declutter/bundleErrors.ts, 20261027211754).
const BUNDLE = BUNDLE_RPC_ERROR_COPY as CopyTable;
// The profile's Declutter "N sold" read, likewise (src/lib/declutter/profileErrors.ts, 20261028202132).
const PROFILE = PROFILE_RPC_ERROR_COPY as CopyTable;
const COPY: CopyTable = { ...SHARED, ...ADMIN, ...HELPR, ...SHOPS, ...HAUL, ...REFUND, ...SELLER_DELIVERY, ...GUARANTEE, ...MEETUP, ...DONATE, ...BUNDLE, ...PROFILE };
/** An RPC that refuses anyone without the admin role, read from its latest definition. */
const ADMIN_GATE = /\bhas_role\s*\([^;]*?'admin'/i;
/** Reads a party OR an admin may call: has_role(.., 'admin') is one branch of an OR, so members get the copy too. */
const PARTY_OR_ADMIN = new Set([
  "declutter_order_problem", // the order's buyer or seller, or an admin (B81, 20261030044444); members see its refusals
]);
const adminGated = new Set([...calls.keys()].filter((rpc) => !PARTY_OR_ADMIN.has(rpc) && ADMIN_GATE.test(defs.get(rpc)?.body ?? "")));
const source = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

describe("the inventory still sees the world", () => {
  it("finds client RPC calls and their codes, including codes raised by a nested function", () => {
    // If a parser change blinds the inventory, every other test here passes
    // on an empty set. These are floors, not snapshots.
    expect(calls.size).toBeGreaterThan(50);
    expect(inventory.size).toBeGreaterThan(15);
    expect(inventory.get("helper_abort_job")?.get("not_abortable")).toBe("helper_abort_job");
    expect(inventory.get("helper_abort_job")?.get("job_already_completed")).toBe("open_dispute_as");
  });

  it("the haul-away table adds only declutter_*haul_away* RPCs, none also in RPC_ERROR_COPY", () => {
    const names = Object.keys(HAUL_AWAY_RPC_ERROR_COPY);
    expect(names.length).toBeGreaterThan(2);
    expect(names.filter((n) => !/^declutter_.*haul_away/.test(n) || n in RPC_ERROR_COPY)).toEqual([]);
  });

  it("the refund table adds only the refund-request RPCs, none also in RPC_ERROR_COPY, each read by the inventory", () => {
    const names = Object.keys(REFUND_RPC_ERROR_COPY);
    expect(names.sort()).toEqual(["rpc_answer_refund_request", "rpc_open_refund_request", "rpc_withdraw_refund_request"]);
    expect(names.filter((n) => n in RPC_ERROR_COPY)).toEqual([]);
    // Both are called from src, and raise codes from the functions they call too.
    expect(calls.has("rpc_open_refund_request") && calls.has("rpc_answer_refund_request")).toBe(true);
    expect(inventory.get("rpc_open_refund_request")?.get("refund_request_crew_job")).toBe("refund_request_assert_job_open");
    expect(inventory.get("rpc_answer_refund_request")?.get("schedule_change_clash")).toBe("request_job_schedule_change");
  });

  it("the seller-delivery table adds only its own RPCs, none also in RPC_ERROR_COPY", () => {
    const names = Object.keys(SELLER_DELIVERY_RPC_ERROR_COPY);
    expect(names.length).toBeGreaterThan(8);
    expect(names.filter((n) => !/^declutter_/.test(n) || n in RPC_ERROR_COPY || n in HAUL_AWAY_RPC_ERROR_COPY)).toEqual([]);
  });

  it("the guarantee table adds only the four guarantee RPCs, none also in RPC_ERROR_COPY, each read by the inventory", () => {
    const names = Object.keys(GUARANTEE_RPC_ERROR_COPY);
    expect(names.sort()).toEqual(["rpc_guarantee_helpr_answer", "rpc_guarantee_mark_fixed", "rpc_guarantee_open", "rpc_guarantee_poster_answer"]);
    expect(names.filter((n) => n in RPC_ERROR_COPY)).toEqual([]);
    expect(names.filter((n) => !calls.has(n))).toEqual([]);
    expect(inventory.get("rpc_guarantee_open")?.get("guarantee_window_closed")).toBe("rpc_guarantee_open");
  });

  it("no RPC is called with a name the inventory cannot read", () => {
    expect(dynamic, "a non-literal .rpc(name) hides that RPC's codes from this guard").toEqual([]);
  });

  it("a call quoted in a comment is not a call", () => {
    // Signup.tsx explains, in a comment, why it no longer calls process_referral.
    expect(calls.has("process_referral")).toBe(false);
  });
});

describe("every code a client-called RPC raises has copy at its call site", () => {
  it("every (rpc, code) is mapped in RPC_ERROR_COPY or allowlisted with a reason", () => {
    const unmapped = findUnmapped(inventory, COPY, UNREACHABLE);
    expect(
      unmapped,
      "Add plain, specific copy to RPC_ERROR_COPY in src/lib/lifecycleErrors.ts (never role-based; done is final), " +
        "or, only if no client can reach it from that call site, an UNREACHABLE entry here saying why.",
    ).toEqual([]);
  });

  it("every call site of an RPC with copy reads it through rpcErrorMessage / rpcErrorCode", () => {
    expect(findUnwired(calls, COPY, source)).toEqual([]);
  });

  it("no copy or allowlist entry names a code the RPC does not raise, or an RPC no client calls", () => {
    const stale: string[] = [];
    for (const [table, entries] of [["RPC_ERROR_COPY", SHARED], ["ADMIN_RPC_ERROR_COPY", ADMIN], ["SELLER_DELIVERY_RPC_ERROR_COPY", SELLER_DELIVERY], ["MEETUP_RPC_ERROR_COPY", MEETUP], ["DONATE_RPC_ERROR_COPY", DONATE], ["BUNDLE_RPC_ERROR_COPY", BUNDLE], ["PROFILE_RPC_ERROR_COPY", PROFILE], ["UNREACHABLE", UNREACHABLE]] as const) {
      for (const [rpc, codes] of Object.entries(entries)) {
        if (!calls.has(rpc)) stale.push(`${table}.${rpc}: no client calls this RPC`);
        for (const code of Object.keys(codes)) {
          if (!inventory.get(rpc)?.has(code)) stale.push(`${table}.${rpc}.${code}: not raised by ${rpc}'s latest definition`);
        }
      }
    }
    for (const [rpc, codes] of Object.entries(UNREACHABLE)) {
      for (const code of Object.keys(codes)) if (COPY[rpc]?.[code]) stale.push(`${rpc}.${code}: both mapped and allowlisted`);
    }
    expect(stale).toEqual([]);
  });

  it("every 'EXECUTE revoked from anon' reason is true of the migrations", () => {
    const wrong: string[] = [];
    for (const [rpc, codes] of Object.entries(UNREACHABLE)) {
      for (const [code, entry] of Object.entries(codes)) {
        if (entry.anonRevoked && !anonExecuteRevoked(rpc, MIGRATIONS)) wrong.push(`${rpc}.${code}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("done is final: no copy about a completed job sends anyone to support", () => {
    const offenders = Object.entries(COPY).flatMap(([rpc, codes]) =>
      Object.entries(codes)
        .filter(([code, text]) => /completed/.test(code) && /support/i.test(text))
        .map(([code]) => `${rpc}.${code}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("admin-only RPC copy stays out of the shared table", () => {
  it("reads the admin-gated inventory (floor)", () => {
    // 2026-10-17 (main 37d9eaeb5): 34 client-called RPCs are admin-gated; the 17
    // that raise codes a screen words are in ADMIN_RPC_ERROR_COPY (payout holds,
    // bans, disputes, feature switches, Declutter review, category review, the
    // team thread).
    expect(adminGated.size).toBeGreaterThan(30);
    expect(Object.keys(ADMIN).length).toBeGreaterThan(15);
    expect(adminGated.has("rpc_settle_dispute_without_payment")).toBe(true);
    expect(adminGated.has("send_team_reply")).toBe(false);
  });

  it("every admin-gated RPC's copy is in ADMIN_RPC_ERROR_COPY, not RPC_ERROR_COPY", () => {
    const misplaced = [...adminGated].filter((rpc) => SHARED[rpc]).map((rpc) => `${rpc}: admin-gated, mapped in the shared RPC_ERROR_COPY`);
    expect(misplaced, "Move it to src/components/admin/adminRpcErrorCopy.ts: the shared table is on every signed-in first screen.").toEqual([]);
  });

  it("ADMIN_RPC_ERROR_COPY holds only admin-gated RPCs, and no RPC is in both tables", () => {
    const wrong = Object.keys(ADMIN).filter((rpc) => !adminGated.has(rpc)).map((rpc) => `${rpc}: in the admin table but its definition has no admin gate`);
    const both = Object.keys(ADMIN).filter((rpc) => SHARED[rpc]).map((rpc) => `${rpc}: in both tables`);
    expect([...wrong, ...both]).toEqual([]);
  });
});

describe("the checks can fail (the original bug, pinned)", () => {
  // The Cancel job handler as it stood before this guard: its own regex for
  // the one code it knew, no shared copy.
  const ORIGINAL_ACTIVE_JOB_SECTION = `
    const handleAbort = async () => {
      const { data, error } = await supabase.rpc("helper_abort_job", { p_job_id: id, p_reason: r });
      if (error) {
        toast.error(
          /not_abortable/.test(error.message)
            ? "This job has already moved on. Refresh the page and take another look."
            : "We couldn’t send that — check your connection and try again.",
        );
      }
    };`;

  it("an RPC code with no copy and no allowlist entry is reported", () => {
    const withoutCompleted: CopyTable = {
      ...COPY,
      helper_abort_job: { not_abortable: "This job has already moved on. Refresh the page and take another look." },
    };
    const onlyAbort = new Map([["helper_abort_job", inventory.get("helper_abort_job")!]]);
    expect(findUnmapped(onlyAbort, withoutCompleted, UNREACHABLE)).toContain(
      "helper_abort_job: 'job_already_completed' (raised by open_dispute_as)",
    );
  });

  it("a call site that matches codes inline instead of reading the shared copy is reported", () => {
    const file = "src/pages/jobs/appliedJobCard/ActiveJobSection.tsx";
    const sites = new Map([["helper_abort_job", [{ file, line: 3 }]]]);
    expect(findUnwired(sites, COPY, () => ORIGINAL_ACTIVE_JOB_SECTION)).toEqual([
      `${file}:3 calls helper_abort_job 1x but reads its copy 0x`,
    ]);
  });

  it("a second call added beside a wired one is reported", () => {
    const text = `
      const a = await supabase.rpc("mark_helper_arrival", {});
      toast.error(rpcErrorMessage("mark_helper_arrival", a.error) ?? "x");
      const b = await supabase.rpc("mark_helper_arrival", {});
      toast.error("Couldn't mark you arrived — try again?");`;
    const sites = new Map([["mark_helper_arrival", [{ file: "f.tsx", line: 2 }, { file: "f.tsx", line: 4 }]]]);
    const copy: CopyTable = { mark_helper_arrival: { job_not_found: "This job no longer exists." } };
    expect(findUnwired(sites, copy, () => text)).toEqual(["f.tsx:2,4 calls mark_helper_arrival 2x but reads its copy 1x"]);
  });

  it("a RAISE quoted in a SQL comment is not a code, a real one is", () => {
    expect(raisedCodes("-- RAISE EXCEPTION 'quoted_in_a_comment';\nRAISE EXCEPTION 'real_code' USING HINT = 'x';")).toEqual([
      "real_code",
    ]);
    expect(raisedCodes("RAISE EXCEPTION 'job not found';")).toEqual([]);
  });
});

// Deleting the copy for a code a client-called RPC really raises must be seen.
// Both sides are DERIVED — call sites from the TypeScript AST of src/, codes
// from the newest migration definition of each RPC and everything it calls —
// and both are floored above (calls > 50, inventory > 15), so an inventory that
// went blind fails loudly instead of passing on an empty set.
// SOURCE-TEXT ONLY: the migrations are the oracle, never prod's pg_get_functiondef.
// @mutate src/lib/lifecycleErrors.ts | job_already_completed: "This job was just marked complete, so it can't be cancelled.",\n | 
// An admin RPC's copy is held to the same rule: deleting one admin code's words fails the unmapped check.
// @mutate src/components/admin/adminRpcErrorCopy.ts |     dispute_has_payment: "This job has a payment on file, so the split has to move it. Use Retry settlement.",\n |
// Putting an admin RPC's copy back in the shared table fails the which-table check.
// @mutate src/lib/lifecycleErrors.ts |   send_team_reply: {\n |   admin_list_signup_leads: { admin_only: "Only admins can see sign-up leads." },\n  send_team_reply: {\n
