/**
 * Account deletion, in one place, for all three callers.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * There are three ways an account leaves this platform — the user asks
 * (`delete-own-account`), an admin removes them (`admin-delete-user`), or the
 * abandoned-signup cron sweeps them (`cleanup-abandoned-accounts`) — and until
 * now all three did the same one thing: call `auth.admin.deleteUser` and hope.
 *
 * Measured against prod on 2026-08-31, that one call:
 *   * FAILED for 10 of 31 accounts with a raw `23503`, which the user saw as
 *     `violates foreign key constraint "jobs_helper_id_fkey"`;
 *   * left the deleted user's **government ID scan** in `id-documents/<uid>/`
 *     and their avatar in the PUBLIC `avatars` bucket, still returning HTTP 200
 *     to an anonymous fetch;
 *   * left a message reading "my address is 123 Elm St, call 555-0142" in
 *     `messages` with a dangling `sender_id` (that table has no FK at all);
 *   * never cancelled the Stripe subscription, so a deleted account kept
 *     billing.
 *
 * Having three copies of a fix this shaped is how the `job_status` enum bug
 * survived in `admin-delete-user` for a day after `delete-own-account` was
 * fixed. So there is one implementation, here.
 *
 * ── Ordering, and why it is this order ──────────────────────────────────────
 * A half-deleted account is worse than either end state, so the steps are
 * ordered such that EVERY intermediate state is coherent and a retry from any
 * point lands in the same place:
 *
 *   1. Cancel Stripe billing.   Failing later must not leave money moving.
 *   2. Purge identity storage.  The ID scan and avatar are the highest-harm
 *                               artifacts; they go before anything can block.
 *   3. purge_user_data() RPC.   One transaction: erases PII rows, redacts the
 *                               profile and the funded jobs, stamps the payout
 *                               ledger. All-or-nothing.
 *   4. auth.admin.deleteUser.   FK CASCADE / SET NULL finishes the job.
 *
 * If step 4 fails, the account is already stripped of every identifying field
 * and every stored document, and re-running lands on the same result — rather
 * than a user who saw an error and still has their licence on our servers.
 * Every step is individually idempotent.
 */

import { removeJobMedia, type JobMediaOwner } from "./jobMedia.ts";
import { classifyMissingSubfolderBuckets, IDENTITY_BUCKETS, identitySubfolderPrefixes, missingBuckets } from "./purgeBuckets.ts";
import { caughtMessage } from "./caughtMessage.ts";
import { recurringVisitDates } from "./recurringSchedule.ts";
import { louisianaToday } from "./louisianaDate.ts";
import { appleSignInKeyFromEnv, revokeAppleSignIn } from "./appleSignIn.ts";

/**
 * Structural, not `SupabaseClient`.
 *
 * The three callers do not agree on a specifier — `delete-own-account` and
 * `admin-delete-user` construct their client from `npm:@supabase/supabase-js@2`,
 * this file was originally typed against `https://esm.sh/@supabase/supabase-js@2`,
 * and TypeScript treats those as two unrelated classes even at identical
 * versions (`Property 'supabaseUrl' is protected but type ... is not a class
 * derived from ...`). Rather than force every caller onto one specifier — a
 * change with a real runtime footprint for a purely type-level complaint —
 * this declares only the surface actually used. It also documents that surface:
 * three methods, no more.
 *
 * The builder return types are deliberately `any`. Spelling them out
 * structurally made the checker try to reconcile PostgREST's builder generics
 * against a hand-written twin and it gave up with TS2589 ("Type instantiation
 * is excessively deep and possibly infinite"). The safety is not lost, only
 * moved: every awaited result below is annotated at the point of use with
 * `PostgrestLike` / `StorageListLike`, so the fields this file actually reads
 * are still checked. What `any` buys is that the boundary stops caring which
 * copy of the SDK a caller happens to hold.
 */
interface PurgeCapableClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  // deno-lint-ignore no-explicit-any
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): any;
  storage: {
    // deno-lint-ignore no-explicit-any
    from(bucket: string): any;
    // deno-lint-ignore no-explicit-any
    listBuckets(): any;
  };
}

/** The shape of every PostgREST/RPC result this file reads. */
interface PostgrestLike<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}
/** The shape of every Storage list/remove result this file reads. */
interface StorageListLike {
  data: { name: string }[] | null;
  error: { message: string } | null;
}

// IDENTITY_BUCKETS and the existence check live in ./purgeBuckets.ts (Q219).

interface PurgeStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface PurgeOutcome {
  ok: boolean;
  steps: PurgeStep[];
  /** Human, actionable message when ok === false. Safe to show a user. */
  userMessage?: string;
  /**
   * Why it failed, when the caller needs to treat one cause differently.
   *
   * `rpc_not_deployed` exists for the deploy-lag window: migrations ship on
   * merge to main, so there is a period where this edge function is live and
   * `purge_user_data` is not. Everything correctly refuses to delete during
   * it — but that is a DEFERRAL, not a fault, and the abandoned-accounts cron
   * would otherwise report a page-worthy error for every candidate it skipped
   * on the day of the deploy. A cron that cries wolf once teaches everyone to
   * ignore it the next time.
   */
  reason?: "rpc_not_deployed" | "storage_failed" | "database_failed" | "stripe_failed";
}

/**
 * The job states that mean a counterparty still has work, money or a claim in
 * flight. Deleting either party here strands the other one.
 *
 * ⚠️ Every value MUST be a real member of the `job_status` enum:
 *   open | accepted | in_progress | completed | cancelled |
 *   revision_requested | disputed | pending_approval
 * Postgres rejects the WHOLE query with 22P02 "invalid input value for enum
 * job_status" if any listed value is not a member — and because every caller
 * fails closed on that error, ONE bad value makes deletion return 500 for
 * EVERY user, including users with no jobs at all. That is exactly what
 * happened: the list carried `arrived` (a `job_tracking.status` value) and
 * `awaiting` (which exists nowhere).
 */
const LIVE_STATUS_FILTER =
  "status.in.(accepted,in_progress,revision_requested,disputed)," +
  // Q2399: a card HELD for an open, listed job is live work too: a hire would
  // charge the deleted poster's card (lh-silent-failure review #13).
  "payment_status.in.(escrow,payout_pending,held)";

export interface ActiveWorkResult {
  /** False means we could not determine it — the caller must fail closed. */
  ok: boolean;
  /** True when the account is party to live work and must not be deleted. */
  active: boolean;
  detail?: string;
  /**
   * "series": the live work is a running recurring series (posted, or dates
   * held on one). Its own copy, because what unblocks it is ending the series
   * (or leaving it), not finishing a job (owner decision Q407 (7)).
   */
  reason?: "job" | "series" | "declutter" | "declutter_held" | "shops" | "money_owed" | "fee_owed";
}

/** What the person is told when a running series blocks deleting their account. */
export const SERIES_BLOCKS_DELETION_MESSAGE =
  "You have a recurring series that is still running. End it from your posts (or leave it from My Jobs if you're doing its visits) before deleting your account.";

/**
 * Is this account on a RUNNING recurring series (Q407 (7), money audit
 * LOW-14)? A series the account POSTED that is not cancelled, not ended
 * (series_ended_on NULL) and still has a visit date today or later; or a date
 * the account HOLDS (series_visit_holds) from today on, on a series that has
 * not ended. Deleting either party mid-series leaves the other with visits
 * nobody can run or pay for.
 */
/** jobs.series_ended_on is not deployed yet (42703 / PGRST204, or the message naming it). */
function isMissingSeriesEndColumn(e: { code?: string | null; message?: string | null }): boolean {
  return e.code === "42703" || e.code === "PGRST204" || /series_ended_on[^"]*does not exist|could not find the 'series_ended_on' column/i.test(e.message ?? "");
}

async function findRunningSeries(admin: PurgeCapableClient, userId: string): Promise<ActiveWorkResult> {
  const today = louisianaToday();
  // `date_needed` bounds the scan exactly as the charge cron does: the last
  // visit of any series is at most 52 weeks after its first.
  const since = new Date(Date.now() - 371 * 86_400_000).toISOString().slice(0, 10);
  type SeriesRow = { id: string; date_needed: string | null; recurrence_days: number[] | null; recurrence_weeks: number | null };
  const postedSeries = (withEnded: boolean): PromiseLike<PostgrestLike<SeriesRow[]>> => {
    // deno-lint-ignore no-explicit-any
    let q: any = admin
      .from("jobs")
      .select("id, date_needed, recurrence_days, recurrence_weeks")
      .eq("customer_id", userId)
      .is("parent_job_id", null)
      .not("recurrence_days", "is", null);
    if (withEnded) q = q.is("series_ended_on", null);
    return q.neq("status", "cancelled").gte("date_needed", since).limit(201);
  };
  let posted: PostgrestLike<SeriesRow[]> = await postedSeries(true);
  // DEPLOY ORDER (review LOW-5): delete-own-account / admin-delete-user can
  // ship before db-deploy adds jobs.series_ended_on (20260927012804). Until it
  // exists no series can have been ended, so the same check without that
  // filter is exact. Only that missing column falls back; any other error
  // fails closed below.
  if (posted.error && isMissingSeriesEndColumn(posted.error)) {
    console.warn(`[accountPurge] jobs.series_ended_on is not deployed yet; checking running series without it for ${userId}`);
    posted = await postedSeries(false);
  }
  if (posted.error) {
    console.error(`[accountPurge] running-series check failed for ${userId}:`, posted.error.message);
    return { ok: false, active: false, detail: posted.error.message };
  }
  const rows = posted.data ?? [];
  if (rows.length > 200) {
    return { ok: false, active: false, detail: "more than 200 series — cannot prove none is running" };
  }
  for (const s of rows) {
    const dates = recurringVisitDates(s.date_needed ?? "", s.recurrence_days ?? [], Number(s.recurrence_weeks ?? 0));
    if (dates.some((d) => d >= today)) {
      return { ok: true, active: true, detail: `series ${s.id}`, reason: "series" };
    }
  }

  const holds: PostgrestLike<Array<{ parent_job_id: string }>> = await admin
    .from("series_visit_holds")
    .select("parent_job_id")
    .eq("helper_id", userId)
    .gte("visit_date", today)
    .limit(201);
  if (holds.error) {
    // The table arrives with 20260927012806; before db-deploy there is
    // nothing to hold. Any other failure fails closed.
    if (/does not exist|42P01|PGRST205/i.test(`${holds.error.code ?? ""} ${holds.error.message}`)) {
      return { ok: true, active: false };
    }
    console.error(`[accountPurge] held-dates check failed for ${userId}:`, holds.error.message);
    return { ok: false, active: false, detail: holds.error.message };
  }
  const parents = [...new Set((holds.data ?? []).map((h) => h.parent_job_id))];
  if (parents.length > 200) {
    return { ok: false, active: false, detail: "held dates on more than 200 series — cannot prove none is running" };
  }
  if (parents.length === 0) return { ok: true, active: false };
  const live: PostgrestLike<Array<{ id: string }>> = await admin
    .from("jobs")
    .select("id")
    .in("id", parents)
    .is("series_ended_on", null)
    .neq("status", "cancelled")
    .limit(1);
  if (live.error) {
    console.error(`[accountPurge] held-series check failed for ${userId}:`, live.error.message);
    return { ok: false, active: false, detail: live.error.message };
  }
  if (live.data && live.data.length > 0) {
    return { ok: true, active: true, detail: `holds dates on series ${live.data[0].id}`, reason: "series" };
  }
  return { ok: true, active: false };
}

/**
 * Is this account party to an in-flight job or holding money in escrow?
 *
 * ── Why this lives here rather than in each caller ──────────────────────────
 * `delete-own-account` and `admin-delete-user` each carried their own copy of
 * this guard, with a comment in one of them promising they were "kept
 * byte-identical so the two guards cannot drift again". They had already
 * drifted: the enum bug above was fixed in one and left in the other for a
 * day, during which admin deletion returned 500 for every target. A comment is
 * not a mechanism. One implementation is.
 *
 * ── Why it takes two queries ────────────────────────────────────────────────
 * A GROUP job's roster lives in `group_job_helpers`, not in `jobs.helper_id` —
 * only the lead helper is ever written to the job row. So a second, third or
 * fourth helper on a live, escrow-funded group job looked completely job-free
 * to the single-table version of this check and could delete their account
 * mid-job, leaving the poster short-handed with the money still held and no
 * party left to release it to. The roster is read first, then its job ids are
 * tested against the same live-status filter, so the two paths cannot disagree
 * about what "live" means.
 */
/**
 * The id reaches a PostgREST `.or()` filter STRING, a storage list prefix and an
 * RPC argument. Only `admin-delete-user` took its id from a request body, and
 * only `admin-delete-user` validated it — which put the check in one caller
 * rather than in the module that builds the filter. Nothing is exploitable
 * today; this is so it stays that way when a fourth caller appears.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findActiveWork(
  admin: PurgeCapableClient,
  userId: string,
): Promise<ActiveWorkResult> {
  if (!UUID_RE.test(userId)) {
    console.error("[accountPurge] findActiveWork called with a non-UUID id");
    return { ok: false, active: false, detail: "userId is not a UUID" };
  }
  // 1. Jobs where this user is the poster or the (lead) helper.
  //    `.or(...).or(...)` ANDs the two clauses: (I'm a party) AND (it's live).
  const direct: PostgrestLike<{ id: string }[]> = await admin
    .from("jobs")
    .select("id")
    .or(`customer_id.eq.${userId},helper_id.eq.${userId}`)
    .or(LIVE_STATUS_FILTER)
    .limit(1);

  if (direct.error) {
    console.error(`[accountPurge] active-job check failed for ${userId}:`, direct.error.message);
    return { ok: false, active: false, detail: direct.error.message };
  }
  if (direct.data && direct.data.length > 0) {
    return { ok: true, active: true, detail: `job ${direct.data[0].id}`, reason: "job" };
  }

  // 1b. A running recurring series, posted or worked (Q407 (7)).
  const series = await findRunningSeries(admin, userId);
  if (!series.ok || series.active) return series;

  // 1c. Declutter money in flight (20261014210518, money review of slice 3):
  //     a cart line waiting for checkout or PAID (money held on the platform
  //     until handover), on either side. Its rows cascade with the account, so
  //     deleting now would erase the only record of what is owed to whom.
  const declutter = await findDeclutterInFlight(admin, userId);
  if (!declutter.ok || declutter.active) return declutter;

  // 1d. A Shops order in progress (Shops M1, 20261018164442), as the buyer or
  //     the shop: a Stripe page open, a card held, or an accepted order not
  //     yet handed over. The database refuses the deletion too
  //     (shop_orders_open_has_parties); this says why in plain words.
  const shopOrder = await findShopOrderInFlight(admin, userId);
  if (!shopOrder.ok || shopOrder.active) return shopOrder;

  // 1e. Money still owed TO this member that only their account can receive
  //     (Q2273, lh-money-escrow review of the board 120 copy). Each row's payee
  //     is SET NULL or orphaned with the account, and the money path then
  //     refuses it, so deleting now would forfeit it.
  const owed = await findMoneyOwedToMember(admin, userId);
  if (!owed.ok || owed.active) return owed;

  // 1f. A live refund request (board 141, Q2272), as the poster who asked or
  //     the Helpr asked: money is being decided between them (open, declined
  //     with its dispute not filed yet, or agreed and not yet split). Its party
  //     columns are SET NULL with the account, and every step after that
  //     refuses a request whose party is gone, so deleting now would strand the
  //     refund or the Helpr's share.
  const refund = await findLiveRefundRequest(admin, userId);
  if (!refund.ok || refund.active) return refund;

  // 2. Group-job rosters. Read the memberships, then test THOSE jobs.
  // 201, not 200: a page that comes back FULL is indistinguishable from a page
  // that was truncated, and silently truncating this read would hand back
  // "no live work" for a helper whose live group job happened to fall off the
  // end. Reading one more than the cap makes truncation detectable, and the
  // branch below fails closed on it rather than guessing.
  const ROSTER_CAP = 200;
  const roster: PostgrestLike<{ job_id: string }[]> = await admin
    .from("group_job_helpers")
    .select("job_id")
    .eq("helper_id", userId)
    .limit(ROSTER_CAP + 1);

  if (roster.error) {
    // A missing table is not a reason to refuse a deletion forever, but any
    // other failure is — we cannot prove the account is safe to remove.
    if (/does not exist|42P01|PGRST205/i.test(`${roster.error.code ?? ""} ${roster.error.message}`)) {
      return { ok: true, active: false, detail: "group_job_helpers absent" };
    }
    console.error(`[accountPurge] roster check failed for ${userId}:`, roster.error.message);
    return { ok: false, active: false, detail: roster.error.message };
  }

  const rosterRows = roster.data ?? [];
  if (rosterRows.length > ROSTER_CAP) {
    console.error(`[accountPurge] roster read for ${userId} hit the ${ROSTER_CAP}-row cap`);
    return {
      ok: false,
      active: false,
      detail: `group roster exceeded ${ROSTER_CAP} rows — cannot prove the account is free of live work`,
    };
  }

  const jobIds = [...new Set(rosterRows.map((r) => r.job_id).filter(Boolean))];
  if (jobIds.length === 0) return { ok: true, active: false };

  const grouped: PostgrestLike<{ id: string }[]> = await admin
    .from("jobs")
    .select("id")
    .in("id", jobIds)
    .or(LIVE_STATUS_FILTER)
    .limit(1);

  if (grouped.error) {
    console.error(`[accountPurge] group-job check failed for ${userId}:`, grouped.error.message);
    return { ok: false, active: false, detail: grouped.error.message };
  }
  if (grouped.data && grouped.data.length > 0) {
    return { ok: true, active: true, detail: `group job ${grouped.data[0].id}`, reason: "job" };
  }

  return { ok: true, active: false };
}

/** The order statuses shop_orders_open_has_parties keeps a buyer, seller and shop on (20261018164442). */
export const SHOP_ORDER_OPEN_STATUSES = ["awaiting_hold", "held", "accepted"];

/** What the member is told when a Shops order in progress blocks deleting their account. */
/** Owner 10-30: a paid Declutter sale nobody has confirmed holds the account too, and the member is told what ends it. */
export const DECLUTTER_HELD_BLOCKS_DELETION_MESSAGE =
  "You have a Declutter sale with money held, because the handover hasn't been confirmed yet. Ask the other person to confirm it, or report a problem on the order in Buying or Selling. You can delete your account once it's settled.";

export const SHOPS_BLOCKS_DELETION_MESSAGE =
  "You have a Shops order in progress: a card hold waiting for the shop's answer, or an accepted order. Withdraw an order you're waiting on (or, for your own shop, accept or decline it), and let accepted orders finish, before deleting your account.";

/**
 * Close the member's own unpaid Shops payment pages ('awaiting_hold': no card
 * held, nothing charged) before the deletion check, exactly as the 2-hour
 * sweep does (shop_order_sweep: status 'expired', close_reason 'page_unpaid').
 * Without it a page neither side can see or close blocked the deletion, and
 * any member could keep a shop owner's account undeletable by asking for a
 * new page every two hours (lh-authz-rls review of 6720f02e6, finding 1).
 * A page paid after this is a closed order with a hold, which
 * shop_holds_to_release already drops. Zero rows is the normal case (no
 * page open), so no row count is asserted. Fails closed on a read error.
 */
export async function closeUnpaidShopPages(admin: PurgeCapableClient, userId: string): Promise<{ ok: boolean; detail?: string }> {
  if (!UUID_RE.test(userId)) return { ok: false, detail: "userId is not a UUID" };
  const res: PostgrestLike<{ id: string }[]> = await admin
    .from("shop_orders")
    .update({ status: "expired", close_reason: "page_unpaid", closed_at: new Date().toISOString() })
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .eq("status", "awaiting_hold")
    .select("id");
  if (res.error) {
    if (/does not exist|42P01|PGRST205/i.test(`${res.error.code ?? ""} ${res.error.message}`)) return { ok: true, detail: "shop_orders absent" };
    console.error(`[accountPurge] closing unpaid Shops pages failed for ${userId}:`, res.error.message);
    return { ok: false, detail: res.error.message };
  }
  return { ok: true };
}

/** A Shops order this member is a party to that is still in progress (fail closed on a read error). */
async function findShopOrderInFlight(admin: PurgeCapableClient, userId: string): Promise<ActiveWorkResult> {
  const rows: PostgrestLike<{ id: string }[]> = await admin
    .from("shop_orders")
    .select("id")
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
    .in("status", SHOP_ORDER_OPEN_STATUSES)
    .limit(1);
  if (rows.error) {
    // Before the Shops orders migration is live the table does not exist: no order can be in progress.
    if (/does not exist|42P01|PGRST205/i.test(`${rows.error.code ?? ""} ${rows.error.message}`)) {
      return { ok: true, active: false, detail: "shop_orders absent" };
    }
    console.error(`[accountPurge] Shops order check failed for ${userId}:`, rows.error.message);
    return { ok: false, active: false, detail: rows.error.message };
  }
  if (rows.data && rows.data.length > 0) {
    return { ok: true, active: true, detail: `shop order ${rows.data[0].id}`, reason: "shops" };
  }
  // Shops M2 (20261018211820; lh-money-escrow review of 819e55ce3 #3): a shop still
  // owed a payout ('pending', or 'failed' and retried) can only be paid to its own
  // account, and the order's seller_id is SET NULL with the account: blocked, as
  // helpr_task_payouts are.
  const owed: PostgrestLike<{ id: string }[]> = await admin
    .from("shop_payouts")
    .select("id, shop_orders!inner(seller_id)")
    .eq("shop_orders.seller_id", userId)
    // A payout held for review is money still owed to this person (20261019070737).
    .in("status", ["pending", "failed", "held_for_review"])
    .limit(1);
  if (owed.error) {
    if (/does not exist|42P01|PGRST205/i.test(`${owed.error.code ?? ""} ${owed.error.message}`)) {
      return { ok: true, active: false, detail: "shop_payouts absent" };
    }
    console.error(`[accountPurge] Shops payout check failed for ${userId}:`, owed.error.message);
    return { ok: false, active: false, detail: owed.error.message };
  }
  if (owed.data && owed.data.length > 0) {
    return { ok: true, active: true, detail: `shop payout ${owed.data[0].id}`, reason: "shops" };
  }
  return { ok: true, active: false };
}

/**
 * Q2273: what the member is told when money still owed to them blocks the
 * delete. It never names a payout hold: a held tip's re-drive row is staff
 * business (20261004220059), so "a tip" is all it says.
 */
export const MONEY_OWED_BLOCKS_DELETION_MESSAGE =
  "Money is still on its way to you: a payment for a cancelled job, a tip, or a payout held by a bank dispute. You can delete your account once it has been paid or settled.";

/** The statuses in which each ledger still owes the member money (Q2273). */
export const CANCELLATION_FEE_OWED_STATUSES = ["pending", "failed"];
export const TIP_REDRIVE_OWED_STATUSES = ["owed", "reversed", "repaying", "failed"];
/**
 * A chargeback-held payout blocks unless the card dispute is known LOST
 * (dispute_status 'dispute_lost'). Fail closed on money (lh-money-escrow
 * re-review of Q2273): the job row cannot tell an open or won card dispute from
 * a lost one when an internal dispute status was already on the job (it is left
 * in place), and a won one there is still owed. The cost: such a job lost at the
 * bank keeps the member blocked until someone clears it (Q2277).
 */
export const CHARGEBACK_SETTLED_DISPUTE_STATUS = "dispute_lost";
/**
 * A clawed-back payout owed back after a won dispute (chargeback_clawbacks):
 * being re-paid, failed to re-pay, or a re-pay waiting on a payout hold
 * (status 'reversed' with held_repay_owed_at set; chargebackClawback.ts).
 */
export const CLAWBACK_OWED_FILTER = "status.in.(repaying,repay_failed),held_repay_owed_at.not.is.null";

/**
 * Q2273: money still owed TO the member, each a fail-closed read:
 *  - cancellation_fee_transfers pending/failed (helper_id SET NULL on delete;
 *    the transfer path then refuses the row);
 *  - tip_hold_redrives owed/reversed/repaying/failed (helper_id has no FK, so
 *    the row would point at a deleted account);
 *  - a crew member's cancellation-fee share (crew_cancellation_fee_shares);
 *  - a job payout held by a card dispute: payment_status 'chargeback' on a job
 *    the member worked (lead or crew) unless the card dispute is known lost,
 *    and a clawed-back payout owed back after a win (CLAWBACK_OWED_FILTER).
 */
async function findMoneyOwedToMember(admin: PurgeCapableClient, userId: string): Promise<ActiveWorkResult> {
  // A missing TABLE only (42P01 / PGRST205): never a missing column (42703,
  // also "does not exist"), which must fail closed.
  const absent = (e: { code?: string; message: string }) => /^(42P01|PGRST205)$/.test(e.code ?? "");
  const fee: PostgrestLike<{ id: string }[]> = await admin
    .from("cancellation_fee_transfers")
    .select("id")
    .eq("helper_id", userId)
    .in("status", CANCELLATION_FEE_OWED_STATUSES)
    .limit(1);
  if (fee.error && !absent(fee.error)) {
    console.error(`[accountPurge] cancellation-fee check failed for ${userId}:`, fee.error.message);
    return { ok: false, active: false, detail: fee.error.message };
  }
  if (fee.data && fee.data.length > 0) {
    return { ok: true, active: true, detail: `cancellation fee ${fee.data[0].id}`, reason: "money_owed" };
  }

  // A crew member's share of a cancellation fee (crew_cancellation_fee_shares,
  // helper_id SET NULL on delete; pending/failed are retried hourly). A $0
  // share is never sent, so it never blocks.
  // Read the page and drop the $0 ones here (a share of 0 is never sent). A
  // FULL page could hide an owed share past it, so it fails closed.
  const SHARE_CAP = 200;
  const share: PostgrestLike<{ id: string; share_amount: number | string }[]> = await admin
    .from("crew_cancellation_fee_shares")
    .select("id, share_amount")
    .eq("helper_id", userId)
    .in("status", CANCELLATION_FEE_OWED_STATUSES)
    .limit(SHARE_CAP + 1);
  if (share.error && !absent(share.error)) {
    console.error(`[accountPurge] crew fee-share check failed for ${userId}:`, share.error.message);
    return { ok: false, active: false, detail: share.error.message };
  }
  if ((share.data?.length ?? 0) > SHARE_CAP) {
    console.error(`[accountPurge] crew fee-share read for ${userId} hit the ${SHARE_CAP}-row cap`);
    return { ok: false, active: false, detail: `crew fee shares exceeded ${SHARE_CAP} rows` };
  }
  const owedShare = (share.data ?? []).find((r) => Number(r.share_amount) > 0);
  if (owedShare) {
    return { ok: true, active: true, detail: `crew fee share ${owedShare.id}`, reason: "money_owed" };
  }

  const tip: PostgrestLike<{ tip_id: string }[]> = await admin
    .from("tip_hold_redrives")
    .select("tip_id")
    .eq("helper_id", userId)
    .in("status", TIP_REDRIVE_OWED_STATUSES)
    .limit(1);
  if (tip.error && !absent(tip.error)) {
    console.error(`[accountPurge] tip re-drive check failed for ${userId}:`, tip.error.message);
    return { ok: false, active: false, detail: tip.error.message };
  }
  if (tip.data && tip.data.length > 0) {
    return { ok: true, active: true, detail: `tip ${tip.data[0].tip_id}`, reason: "money_owed" };
  }

  // A held chargeback payout, as the lead Helpr.
  const held: PostgrestLike<{ id: string }[]> = await admin
    .from("jobs")
    .select("id")
    .eq("helper_id", userId)
    .eq("payment_status", "chargeback")
    .or(`dispute_status.is.null,dispute_status.neq.${CHARGEBACK_SETTLED_DISPUTE_STATUS}`)
    .limit(1);
  if (held.error) {
    console.error(`[accountPurge] chargeback-held check failed for ${userId}:`, held.error.message);
    return { ok: false, active: false, detail: held.error.message };
  }
  if (held.data && held.data.length > 0) {
    return { ok: true, active: true, detail: `chargeback-held job ${held.data[0].id}`, reason: "money_owed" };
  }

  // ...and as a crew member of a group job.
  const crew: PostgrestLike<{ job_id: string }[]> = await admin
    .from("group_job_helpers")
    .select("job_id, jobs!inner(payment_status, dispute_status)")
    .eq("helper_id", userId)
    .eq("jobs.payment_status", "chargeback")
    .or(`dispute_status.is.null,dispute_status.neq.${CHARGEBACK_SETTLED_DISPUTE_STATUS}`, { referencedTable: "jobs" })
    .limit(1);
  if (crew.error && !absent(crew.error)) {
    console.error(`[accountPurge] crew chargeback-held check failed for ${userId}:`, crew.error.message);
    return { ok: false, active: false, detail: crew.error.message };
  }
  if (crew.data && crew.data.length > 0) {
    return { ok: true, active: true, detail: `chargeback-held group job ${crew.data[0].job_id}`, reason: "money_owed" };
  }

  // A payout already clawed back and now being re-paid after a won dispute.
  const claw: PostgrestLike<{ id: string }[]> = await admin
    .from("chargeback_clawbacks")
    .select("id")
    .eq("helper_id", userId)
    .or(CLAWBACK_OWED_FILTER)
    .limit(1);
  if (claw.error && !absent(claw.error)) {
    console.error(`[accountPurge] clawback re-pay check failed for ${userId}:`, claw.error.message);
    return { ok: false, active: false, detail: claw.error.message };
  }
  if (claw.data && claw.data.length > 0) {
    return { ok: true, active: true, detail: `clawback ${claw.data[0].id}`, reason: "money_owed" };
  }
  return { ok: true, active: false };
}

/**
 * Q2171: what the member is told when a fee they OWE blocks deleting their
 * account (a card fee from a Helpr-at-fault refund, or a Declutter seller's
 * card fee after a refund). Both come out of the member's next payout.
 */
export const FEE_DEBT_BLOCKS_DELETION_MESSAGE =
  "You still owe money from a refunded job or Declutter sale. It comes out of your next payout. You can delete your account once it is paid off; if no payout is coming, contact support to settle it.";

/**
 * A Helpr-at-fault ruling the member still owes on: a card fee left to pay
 * (card_fee_remaining_cents > 0), or a ruling whose full refund has not been
 * priced yet (card_fee_cents null: the refund or its bill has not finished,
 * and admin_bill_helpr_fault can still bill it).
 */
export const FEE_DEBT_RULING_FILTER = "card_fee_cents.is.null,card_fee_remaining_cents.gt.0";

/**
 * Q2171 (lh-money-escrow@c4ec33afb#4): a fee debt the member OWES. Not part of
 * findActiveWork: that check also gates the under-13 deletion (which the law
 * requires) and the admin delete, where a debt is no reason to keep an account.
 * delete-own-account calls this one itself. job_helpr_fault_rulings.helper_id is
 * SET NULL on delete and declutter_seller_fee_debts CASCADE with the account,
 * so deleting now would lose the debt (the owner rule is never absorb a fee).
 * Fails closed on a read error; a missing TABLE (42P01 / PGRST205) owes nothing.
 */
export async function findFeeDebtOwed(admin: PurgeCapableClient, userId: string): Promise<ActiveWorkResult> {
  if (!UUID_RE.test(userId)) return { ok: false, active: false, detail: "userId is not a UUID" };
  // A missing TABLE only, never a missing column (42703 fails closed).
  const tableAbsent = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";
  const ruling: PostgrestLike<{ id: string }[]> = await admin
    .from("job_helpr_fault_rulings")
    .select("id")
    .eq("helper_id", userId)
    .or(FEE_DEBT_RULING_FILTER)
    .limit(1);
  if (ruling.error && !tableAbsent(ruling.error)) {
    console.error(`[accountPurge] Helpr-at-fault fee check failed for ${userId}:`, ruling.error.message);
    return { ok: false, active: false, detail: ruling.error.message };
  }
  if (ruling.data && ruling.data.length > 0) {
    return { ok: true, active: true, detail: `helpr fault ruling ${ruling.data[0].id}`, reason: "fee_owed" };
  }
  const seller: PostgrestLike<{ id: string }[]> = await admin
    .from("declutter_seller_fee_debts")
    .select("id")
    .eq("seller_id", userId)
    .gt("remaining_cents", 0)
    .limit(1);
  if (seller.error && !tableAbsent(seller.error)) {
    console.error(`[accountPurge] Declutter fee-debt check failed for ${userId}:`, seller.error.message);
    return { ok: false, active: false, detail: seller.error.message };
  }
  if (seller.data && seller.data.length > 0) {
    return { ok: true, active: true, detail: `declutter fee debt ${seller.data[0].id}`, reason: "fee_owed" };
  }
  return { ok: true, active: false };
}

/**
 * A live refund request this member asked or was asked (board 141, Q2272):
 * open, declined with its dispute not filed yet, or agreed with its decided
 * dispute not executed. Fails closed on a read error; a missing table (42P01 /
 * PGRST205, the migration-lag window) holds nobody. Two reads so an agreed
 * request is judged by its OWN dispute's state (an old, settled agreement
 * never blocks), the same rule as public.refund_request_is_live.
 */
async function findLiveRefundRequest(admin: PurgeCapableClient, userId: string): Promise<ActiveWorkResult> {
  // A missing TABLE only, never a missing column (42703 fails closed).
  const absent = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205";
  const party = `requester_id.eq.${userId},responder_id.eq.${userId}`;
  const waiting: PostgrestLike<{ id: string }[]> = await admin
    .from("refund_requests")
    .select("id")
    .or(party)
    .or(REFUND_REQUEST_WAITING_FILTER)
    .limit(1);
  if (waiting.error && !absent(waiting.error)) {
    console.error(`[accountPurge] refund request check failed for ${userId}:`, waiting.error.message);
    return { ok: false, active: false, detail: waiting.error.message };
  }
  if (waiting.data && waiting.data.length > 0) {
    return { ok: true, active: true, detail: `refund request ${waiting.data[0].id}`, reason: "job" };
  }
  const agreed: PostgrestLike<{ id: string }[]> = await admin
    .from("refund_requests")
    .select("id, disputes!refund_requests_dispute_id_fkey!inner(status, execution_status)")
    .or(party)
    .eq("status", "agreed")
    .eq("disputes.status", "decided")
    .or("execution_status.is.null,execution_status.neq.executed", { referencedTable: "disputes" })
    .limit(1);
  if (agreed.error && !absent(agreed.error)) {
    console.error(`[accountPurge] agreed refund check failed for ${userId}:`, agreed.error.message);
    return { ok: false, active: false, detail: agreed.error.message };
  }
  if (agreed.data && agreed.data.length > 0) {
    return { ok: true, active: true, detail: `agreed refund ${agreed.data[0].id}`, reason: "job" };
  }
  return { ok: true, active: false };
}

/** A refund request still waiting: open, a come-back offer not yet settled (Q2326), or declined with its dispute not filed yet. */
export const REFUND_REQUEST_WAITING_FILTER = "status.in.(open,finish_offered,coming_back),and(status.eq.declined,dispute_id.is.null)";

/** A Declutter sale this member is a party to that is not settled yet (fail closed on a read error). */
/** A delivery task still running: its applied raises are paid to the Helpr or refunded when it ends. */
const RAISE_TASK_RUNNING = ["open", "accepted", "picked_up", "delivered"];

/** declutter_delivery_raises on an order this member is the buyer or seller of (Q1929); with its task's status when asked. */
// deno-lint-ignore no-explicit-any
function raiseQuery(admin: PurgeCapableClient, userId: string, withTask = false): any {
  return admin
    .from("declutter_delivery_raises")
    .select(withTask ? "id, declutter_orders!inner(buyer_id, seller_id), helpr_tasks!inner(status)" : "id, declutter_orders!inner(buyer_id, seller_id)")
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`, { referencedTable: "declutter_orders" });
}

const HELD_LABEL = "paid, money held until handover";

async function findDeclutterInFlight(admin: PurgeCapableClient, userId: string): Promise<ActiveWorkResult> {
  // A cart line stays 'paid' forever after its sale (there is no later line status), so a paid line is in flight
  // only while its ORDER still holds the money (order status 'paid', before handover or refund). Counting every paid
  // line blocked a buyer or seller from ever deleting their account after their first sale (Q2307, 2026-10-21).
  // Once settled, the order and its lines outlive the account with the party SET NULL (20261021204947).
  const checks: Array<{ label: string; build: () => PromiseLike<PostgrestLike<{ id: string }[]>> }> = [
    { label: "waiting for checkout", build: () => admin
      .from("declutter_cart_items").select("id")
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .eq("status", "in_cart").limit(1) },
    { label: HELD_LABEL, build: () => admin
      .from("declutter_cart_items").select("id, declutter_orders!inner(status)")
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .eq("status", "paid").eq("declutter_orders.status", "paid").limit(1) },
    // The seller's own payout still to go: it can only be sent to their account (seller_id is SET NULL with it).
    { label: "seller payout owed", build: () => admin
      .from("declutter_payouts").select("id")
      .eq("seller_id", userId)
      .in("status", ["pending", "failed", "held_for_review"]).limit(1) },
    // A problem still open on one of their sales: an admin's decision refunds, pays or strikes a party, which needs
    // both parties to still exist (a strike's user_id is NOT NULL).
    { label: "problem being decided", build: () => admin
      .from("declutter_problems").select("id, declutter_orders!inner(buyer_id, seller_id)")
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`, { referencedTable: "declutter_orders" })
      .eq("status", "open").limit(1) },
    // Board 141 (20261026155251): a refund request after the handover still waiting for an answer moves money
    // when it is answered (the seller's payout is held until then), which needs both parties to still exist.
    { label: "refund request waiting", build: () => admin
      .from("declutter_refund_requests").select("id, declutter_orders!inner(buyer_id, seller_id)")
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`, { referencedTable: "declutter_orders" })
      .in("status", ["open", "offered", "returning"]).limit(1) },
    // After the seller's "no" the buyer may still report a problem for 24 hours, and an admin's decision may strike
    // either party (lh-authz-rls review of 141d, should-fix 2).
    { label: "refund request declined, report window open", build: () => admin
      .from("declutter_refund_requests").select("id, declutter_orders!inner(buyer_id, seller_id)")
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`, { referencedTable: "declutter_orders" })
      .eq("status", "declined").gt("declined_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).limit(1) },
  ];
  for (const c of checks) {
    const lines = await c.build();
    if (lines.error) {
      // Only a MISSING TABLE (by code, never by message) means "nothing in flight": a missing column (42703) or a
      // drifted relationship fails closed, and the next check still runs (lh-money-escrow review 2026-10-21 #4).
      if (lines.error.code === "42P01" || lines.error.code === "PGRST205") continue;
      console.error(`[accountPurge] Declutter check failed for ${userId}:`, lines.error.message);
      return { ok: false, active: false, detail: lines.error.message };
    }
    if (lines.data && lines.data.length > 0) {
      return { ok: true, active: true, detail: `declutter sale ${lines.data[0].id} (${c.label})`, reason: c.label === HELD_LABEL ? "declutter_held" : "declutter" };
    }
  }
  // Slice 5, Helpr delivery (20261017055505): a Helpr who has taken a delivery
  // and not finished it holds someone's item, and a Helpr whose pay is still
  // pending or being retried ('failed' is retried with back-off) is owed money the payout can only send to their account
  // (helpr_task_payouts.helpr_id is SET NULL with the account).
  const tasks = await activeHelprRows(admin, "helpr_tasks", userId, ["accepted", "picked_up", "delivered"]);
  if (!tasks.ok || tasks.active) return tasks.active ? { ...tasks, detail: `helpr delivery ${tasks.detail}` } : tasks;
  const pay = await activeHelprRows(admin, "helpr_task_payouts", userId, ["pending", "failed", "held_for_review"]);
  if (!pay.ok || pay.active) return pay.active ? { ...pay, detail: `helpr delivery pay ${pay.detail}` } : pay;
  // Q1929: a delivery-pay raise not settled yet on an order this member is part of. In flight means: a raise
  // page still payable (a Checkout page lives 31 minutes, so an abandoned one stops counting after that), a
  // paid raise on a delivery that is still running (open, taken, picked up or delivered: it is either paid to
  // the Helpr at confirmation or refunded when the task ends unpaid), or a refund still to go back to the
  // buyer. Keyed on the TASK, not on payout_transfer_id, which stays empty for a payout settled by hand
  // (lh-money-escrow re-review 2026-10-21 #3). A settled raise is history: its order_id is ON DELETE SET NULL,
  // so it never blocks the order's cascade (lh-money-escrow review findings 1 and 2).
  const pageCutoff = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  const raiseChecks: Array<{ label: string; build: () => PromiseLike<{ data: { id: string }[] | null; error: { code?: string; message: string } | null }> }> = [
    { label: "refund to send", build: () => raiseQuery(admin, userId).eq("status", "refunding").limit(1) },
    { label: "delivery running", build: () => raiseQuery(admin, userId, true).eq("status", "applied").in("helpr_tasks.status", RAISE_TASK_RUNNING).limit(1) },
    { label: "page open", build: () => raiseQuery(admin, userId).eq("status", "awaiting_payment").gt("created_at", pageCutoff).limit(1) },
  ];
  for (const c of raiseChecks) {
    const raises = await c.build();
    if (raises.error) {
      if (/does not exist|42P01|PGRST205|PGRST200/i.test(`${raises.error.code ?? ""} ${raises.error.message}`)) {
        return { ok: true, active: false, detail: "declutter_delivery_raises absent" };
      }
      console.error(`[accountPurge] delivery raise check failed for ${userId}:`, raises.error.message);
      return { ok: false, active: false, detail: raises.error.message };
    }
    if (raises.data && raises.data.length > 0) {
      return { ok: true, active: true, detail: `declutter delivery raise ${raises.data[0].id} (${c.label})`, reason: "declutter" };
    }
  }
  return { ok: true, active: false };
}

/** One row of `table` with helpr_id = the member in one of `statuses` (fail closed on a read error; an absent table is none). */
async function activeHelprRows(admin: PurgeCapableClient, table: string, userId: string, statuses: string[]): Promise<ActiveWorkResult> {
  const rows: PostgrestLike<{ id: string }[]> = await admin
    .from(table)
    .select("id")
    .eq("helpr_id", userId)
    .in("status", statuses)
    .limit(1);
  if (rows.error) {
    if (/does not exist|42P01|PGRST205/i.test(`${rows.error.code ?? ""} ${rows.error.message}`)) {
      return { ok: true, active: false, detail: `${table} absent` };
    }
    console.error(`[accountPurge] ${table} check failed for ${userId}:`, rows.error.message);
    return { ok: false, active: false, detail: rows.error.message };
  }
  if (rows.data && rows.data.length > 0) return { ok: true, active: true, detail: rows.data[0].id, reason: "declutter" };
  return { ok: true, active: false };
}

/**
 * Cancel any live Stripe subscription so a deleted account stops billing.
 *
 * Best-effort by design, and that is a deliberate trade-off rather than a
 * swallowed error: if Stripe is unreachable we would rather complete the
 * deletion (the legally-required act) and leave a loud log line than refuse to
 * delete someone's account because a third party is down. The failure is
 * recorded in the returned steps, never dropped.
 */
async function cancelStripeSubscription(
  admin: PurgeCapableClient,
  userId: string,
  steps: PurgeStep[],
): Promise<void> {
  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret) {
    steps.push({ step: "stripe", ok: true, detail: "no STRIPE_SECRET_KEY configured — skipped" });
    return;
  }

  // `stripe_subscription_id` / `stripe_customer_id` arrived in
  // 20260901011254_stripe_subscription_linkage_and_tier_lockdown.sql. Until
  // that migration lands in every environment the columns may not exist, and
  // PostgREST answers 42703/PGRST204 for the WHOLE select — which would take
  // the entire deletion down with it. Ask for them separately and degrade.
  let subscriptionId: string | null = null;
  const linkage: PostgrestLike<{ stripe_subscription_id: string | null }> = await admin
    .from("profiles")
    .select("stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (linkage.error) {
    // Not fatal: an older schema simply has no subscription pointer to read.
    steps.push({
      step: "stripe",
      ok: true,
      detail: `subscription linkage unreadable (${linkage.error.code ?? "?"}: ${linkage.error.message}) — nothing to cancel`,
    });
    return;
  }
  subscriptionId = linkage.data?.stripe_subscription_id ?? null;

  if (!subscriptionId) {
    steps.push({ step: "stripe", ok: true, detail: "no active subscription on file" });
    return;
  }

  try {
    const Stripe = (await import("https://esm.sh/stripe@18.5.0")).default;
    const stripe = new Stripe(secret, { apiVersion: "2025-08-27.basil" });
    await stripe.subscriptions.cancel(subscriptionId);
    steps.push({ step: "stripe", ok: true, detail: `cancelled ${subscriptionId}` });
  } catch (err) {
    const msg = caughtMessage(err);
    // Already-cancelled and already-deleted are SUCCESS for our purposes:
    // the goal is "this account is not billing", and it isn't. Treating them
    // as failures would make a retry permanently un-completable.
    if (/No such subscription|already canceled|already cancelled/i.test(msg)) {
      steps.push({ step: "stripe", ok: true, detail: `already cancelled (${subscriptionId})` });
      return;
    }
    console.error(`[accountPurge] Stripe cancel failed for ${userId}:`, msg);
    steps.push({ step: "stripe", ok: false, detail: `cancel failed: ${msg}` });
  }
}

/**
 * Delete every object under `<userId>/` in each identity bucket.
 *
 * Idempotent: a second run lists nothing and removes nothing. Note that
 * `storage.remove()` returns `{ data: [], error: null }` for paths that do not
 * exist — a null error here genuinely does not mean anything was removed,
 * which is why the count comes from the LIST, not from the remove.
 */
/** Storage caps one `list` page at 1000 rows and silently truncates past it. */
const STORAGE_LIST_PAGE = 1000;
/**
 * Pages read per prefix before giving up (200k objects). A real folder never
 * gets near it; the bound only stops a runaway loop.
 */
const STORAGE_LIST_MAX_PAGES = 200;

/**
 * Every FILE under a prefix, recursing into sub-prefixes.
 *
 * Supabase Storage has no real directories: `list(prefix)` returns one row per
 * immediate child, and a sub-prefix comes back as a pseudo-row with `id: null`
 * and no metadata. That distinction is load-bearing here, because
 * `remove(["<uid>/portfolio"])` — a prefix, not an object — deletes nothing
 * and still answers `{ error: null }`.
 *
 * A flat, non-recursive version of this shipped and was doubly wrong. It never
 * erased anything nested, and three of the five identity buckets nest:
 *   avatars/<uid>/portfolio/…                 (usePortfolio.ts)
 *   user-documents/<uid>/credentials/…        (CredentialsTab.tsx)
 *   user-documents/<uid>/support/…            (SupportInline.tsx)
 *   application-attachments/<uid>/<jobId>/…   (AppliedJobsTab.tsx)
 * And because the verification re-list then still saw the untouched folder, it
 * reported failure — permanently, for anyone who had ever uploaded a portfolio
 * photo or a credential. The flat objects beside it (the avatar, the ID scan)
 * WERE deleted first, so every retry left the account further half-purged
 * while still telling the user to try again. Recursing fixes both halves.
 */
export async function listAllObjects(
  admin: PurgeCapableClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const found: string[] = [];
  const queue: string[] = [prefix];
  // Depth is bounded by the paths above (<uid>/<folder>/<file>); the guard is
  // for a malformed tree, not a legitimate one.
  let visited = 0;

  while (queue.length > 0 && visited < 500) {
    const current = queue.shift()!;
    visited++;
    // Page through the prefix. A folder can legitimately hold more than one
    // page: quote photos sit flat in <uid>/quotes/ with a fresh name per
    // upload (lh-silent-failure review, 2026-10-15). The old single-page read
    // threw at 1000 entries, so one busy quoter's deletion failed on every
    // retry. A full page means "read the next one"; a short page is the end.
    for (let page = 0; ; page++) {
      if (page >= STORAGE_LIST_MAX_PAGES) {
        throw new Error(
          `listing ${bucket}/${current} passed ${STORAGE_LIST_MAX_PAGES} pages — refusing to claim a complete purge`,
        );
      }
      const { data, error }: StorageListLike = await admin.storage
        .from(bucket)
        .list(current, {
          limit: STORAGE_LIST_PAGE,
          offset: page * STORAGE_LIST_PAGE,
          sortBy: { column: "name", order: "asc" },
        });
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;

      for (const entry of data) {
        const path = `${current}/${entry.name}`;
        // `id === null` marks a sub-prefix rather than a stored object.
        if ((entry as { id?: string | null }).id == null) {
          queue.push(path);
        } else {
          found.push(path);
        }
      }
      if (data.length < STORAGE_LIST_PAGE) break;
    }
  }

  if (queue.length > 0) {
    throw new Error(`listing ${bucket}/${prefix} exceeded the traversal bound`);
  }
  return found;
}

/**
 * Point `profiles.avatar_url` at nothing BEFORE the avatar object is deleted.
 *
 * `purge_user_data()` nulls the column too, but it runs AFTER the storage
 * purge — and every step between them (ban retention, the RPC itself) can stop
 * the deletion. A stopped deletion is a live account the user is told to retry
 * from, and until now its row still named `avatars/<uid>/avatar.<ext>`, which
 * the storage step had just deleted: a broken photo, a 400 on every screen that
 * renders them. Clearing the row first means the row never names a missing
 * object on any path.
 *
 * Never blocks the purge: the deletion is the legally-required act, and a
 * stale pointer is a rendering defect, not a privacy one. But the result is
 * recorded, never dropped, and zero rows is legitimate only because an
 * abandoned signup can reach this with no profile row at all.
 */
async function clearAvatarPointer(
  admin: PurgeCapableClient,
  userId: string,
  steps: PurgeStep[],
): Promise<void> {
  const { data, error }: PostgrestLike<{ user_id: string }[]> = await admin
    .from("profiles")
    .update({ avatar_url: null })
    .eq("user_id", userId)
    .select("user_id");
  if (error) {
    console.error(`[accountPurge] clearing avatar_url failed for ${userId}:`, error.message);
    steps.push({ step: "avatar_pointer", ok: false, detail: `${error.code ?? "?"}: ${error.message}` });
    return;
  }
  steps.push({
    step: "avatar_pointer",
    ok: true,
    detail: (data?.length ?? 0) > 0
      ? "avatar_url cleared before the avatar object is removed"
      : "no profile row — nothing points at the avatar",
  });
}

async function purgeIdentityStorage(
  admin: PurgeCapableClient,
  userId: string,
  steps: PurgeStep[],
  extraPaths: { bucket: string; paths: string[] }[] = [],
): Promise<boolean> {
  let allOk = true;
  let totalRemoved = 0;
  const failures: string[] = [];
  const notes: string[] = [];

  const targets: { bucket: string; paths: string[] }[] = [];

  // Q219: a list of a bucket that does not exist answers [] with no error, so
  // "missing" reads as "empty" and the step would report ok while erasing
  // nothing. Ask Storage which buckets exist, and fail on any we do not know.
  let present: string[] = [];
  // Per-user folders inside job-keyed buckets (Declutter photos, B4): listed
  // and verified by their <uid>/<folder> prefix, never the whole bucket.
  const subfolders = identitySubfolderPrefixes(userId);
  let presentSubfolders: { bucket: string; prefix: string }[] = [];
  try {
    const missingSub = await missingBuckets(admin, [...new Set(subfolders.map((s) => s.bucket))]);
    const { notCreatedYet, failing } = classifyMissingSubfolderBuckets(missingSub);
    // A bucket whose migration has not run yet holds nothing: nothing to erase, logged (purgeBuckets.ts).
    for (const bucket of notCreatedYet) {
      console.warn(`[accountPurge] subfolder bucket ${bucket} is not created yet; nothing can be stored there, nothing to erase`);
      notes.push(`${bucket}: not created yet, nothing to erase`);
    }
    for (const bucket of failing) {
      console.error(`[accountPurge] identity subfolder bucket ${bucket} does not exist`);
      failures.push(`${bucket}: bucket does not exist — nothing there could be erased`);
      allOk = false;
    }
    presentSubfolders = subfolders.filter((s) => !missingSub.includes(s.bucket));
  } catch (err) {
    const msg = caughtMessage(err);
    console.error(`[accountPurge] could not check identity subfolder buckets exist:`, msg);
    failures.push(`subfolder buckets: ${msg}`);
    allOk = false;
  }
  try {
    const missing = await missingBuckets(admin, IDENTITY_BUCKETS);
    for (const bucket of missing) {
      console.error(`[accountPurge] identity bucket ${bucket} does not exist`);
      failures.push(`${bucket}: bucket does not exist — nothing there could be erased`);
      allOk = false;
    }
    present = IDENTITY_BUCKETS.filter((b) => !missing.includes(b));
  } catch (err) {
    const msg = caughtMessage(err);
    console.error(`[accountPurge] could not check identity buckets exist:`, msg);
    failures.push(`buckets: ${msg}`);
    allOk = false;
  }

  for (const bucket of present) {
    try {
      targets.push({ bucket, paths: await listAllObjects(admin, bucket, userId) });
    } catch (err) {
      const msg = caughtMessage(err);
      console.error(`[accountPurge] list ${bucket}/${userId} failed:`, msg);
      failures.push(`${bucket}: ${msg}`);
      allOk = false;
    }
  }
  for (const { bucket, prefix } of presentSubfolders) {
    try {
      targets.push({ bucket, paths: await listAllObjects(admin, bucket, prefix) });
    } catch (err) {
      const msg = caughtMessage(err);
      console.error(`[accountPurge] list ${bucket}/${prefix} failed:`, msg);
      failures.push(`${bucket}/${prefix}: ${msg}`);
      allOk = false;
    }
  }
  // Objects that are NOT under a <uid>/ prefix and so cannot be discovered by
  // listing — currently the user's chat attachments, which live under
  // <job_id>/<sender_id>/ and are reachable only via messages.attachment_url.
  targets.push(...extraPaths);

  for (const { bucket, paths } of targets) {
    // One remove call per page-sized batch: a listing can now return more
    // than one page, and Storage takes at most that many paths per call.
    for (let i = 0; i < paths.length; i += STORAGE_LIST_PAGE) {
      const batch = paths.slice(i, i + STORAGE_LIST_PAGE);
      const { error: rmErr }: { error: { message: string } | null } =
        await admin.storage.from(bucket).remove(batch);
      if (rmErr) {
        console.error(`[accountPurge] remove ${batch.length} from ${bucket} failed:`, rmErr.message);
        failures.push(`${bucket}: ${rmErr.message}`);
        allOk = false;
        continue;
      }
      totalRemoved += batch.length;
    }
  }

  // Verify by re-listing rather than trusting the null error. This is the
  // storage twin of the "a null error does not mean the write happened" rule,
  // and it matters here because these are government ID scans.
  for (const bucket of present) {
    try {
      const left = await listAllObjects(admin, bucket, userId);
      if (left.length > 0) {
        failures.push(`${bucket}: ${left.length} object(s) still present after remove`);
        allOk = false;
      }
    } catch (err) {
      const msg = caughtMessage(err);
      failures.push(`${bucket}: could not verify removal (${msg})`);
      allOk = false;
    }
  }

  for (const { bucket, prefix } of presentSubfolders) {
    try {
      const left = await listAllObjects(admin, bucket, prefix);
      if (left.length > 0) {
        failures.push(`${bucket}/${prefix}: ${left.length} object(s) still present after remove`);
        allOk = false;
      }
    } catch (err) {
      const msg = caughtMessage(err);
      failures.push(`${bucket}/${prefix}: could not verify removal (${msg})`);
      allOk = false;
    }
  }

  steps.push({
    step: "storage",
    ok: allOk,
    detail: allOk
      ? `removed ${totalRemoved} object(s)${notes.length > 0 ? `; ${notes.join("; ")}` : ""}`
      : `removed ${totalRemoved}, failures: ${failures.join("; ")}${notes.length > 0 ? `; ${notes.join("; ")}` : ""}`,
  });
  return allOk;
}

/**
 * Carry an active ban across the deletion, before anything erases the account.
 *
 * WHY THIS RUNS AT ALL. Deletion here anonymises rather than deletes, but the
 * ban is one of the few things it genuinely destroys: `profiles` CASCADEs off
 * `auth.users`, taking `ban_status` and `auto_suspended_until` with it;
 * `user_bans` survives only because it has no foreign key, and its rows point
 * at a `user_id` a returning user will never be issued again; `purge_user_data`
 * deletes `fraud_flags` outright; and the auth delete frees the email address.
 * So a banned user who deletes their account is un-banned, and the address that
 * carried the ban is available again. That was harmless only while the route
 * was unreachable — the companion change puts the delete control on
 * /account-banned, which is what Apple requires. See
 * 20260903014600_ban_survives_self_deletion.sql for the retention argument.
 *
 * WHY IT IS ORDERED HERE. `retain_ban_on_deletion` reads `profiles.email`, and
 * step 4e of `purge_user_data` nulls it. Called afterwards it would return 0
 * with no error — a silent no-op nobody would notice until a banned user came
 * back. It must precede `purgeDatabaseRows`, and the call site below is the
 * only thing enforcing that.
 *
 * WHY THE ban_status READ COMES FIRST. Migrations deploy on merge, so there is
 * a window where this function is live and the RPC is not. Failing closed on
 * PGRST202 for EVERY deletion would take an App-Store-required capability down
 * for the whole window to protect a case that applies to almost nobody. So the
 * ban is read with a plain select — always available — and the RPC is called
 * only when there is actually a ban to retain. For that user we DO fail
 * closed: completing the deletion is what destroys the evidence, and there is
 * no second chance afterwards.
 */
async function retainBanIfAny(
  admin: PurgeCapableClient,
  userId: string,
  steps: PurgeStep[],
): Promise<boolean> {
  const BAN_STATUSES = ["banned", "temp_banned", "permanently_banned"];

  const { data: profile, error: readErr }: PostgrestLike<{ ban_status: string | null }> =
    await admin.from("profiles").select("ban_status").eq("user_id", userId).maybeSingle();

  if (readErr) {
    console.error(`[accountPurge] ban_status read failed for ${userId}:`, readErr.message);
    steps.push({ step: "retain_ban", ok: false, detail: `ban_status read failed: ${readErr.message}` });
    return false;
  }

  const status = profile?.ban_status ?? null;
  if (!status || !BAN_STATUSES.includes(status)) {
    steps.push({ step: "retain_ban", ok: true, detail: `not banned (${status ?? "null"}) — nothing to retain` });
    return true;
  }

  const { data, error }: PostgrestLike<number> =
    await admin.rpc("retain_ban_on_deletion", { p_user_id: userId });

  if (error) {
    console.error(`[accountPurge] retain_ban_on_deletion failed for ${userId}:`, error.message);
    steps.push({
      step: "retain_ban",
      ok: false,
      detail: error.code === "PGRST202"
        ? "retain_ban_on_deletion RPC not deployed yet (PGRST202) — refusing to delete a banned account without it"
        : `${error.code ?? "?"}: ${error.message}`,
    });
    return false;
  }

  // A null `error` does NOT mean the write happened. The RPC returns the row
  // count for exactly this check: it answers 0 when the profile was already
  // anonymised (email NULL) or when the suspension had already lapsed, and
  // neither of those is a failure — but only the count can distinguish them
  // from "the statement matched nothing".
  const retained = typeof data === "number" ? data : null;
  if (retained === null) {
    steps.push({
      step: "retain_ban",
      ok: false,
      detail: "retain_ban_on_deletion returned no count — treating as not-run",
    });
    return false;
  }

  steps.push({
    step: "retain_ban",
    ok: true,
    detail: retained > 0
      ? `retained ${status} against email hash`
      : `${status} not retained (already anonymised, or the suspension had lapsed)`,
  });
  return true;
}

/**
 * The database half: one transactional RPC, defined in
 * 20260901033011_account_deletion_retention_policy.sql.
 */
async function purgeDatabaseRows(
  admin: PurgeCapableClient,
  userId: string,
  steps: PurgeStep[],
): Promise<{ ok: boolean; notDeployed: boolean }> {
  const { data, error }: PostgrestLike<Record<string, number | string>> =
    await admin.rpc("purge_user_data", { p_user_id: userId });

  if (error) {
    // PGRST202 = the function is not in the schema cache yet. Migrations
    // auto-deploy on merge, so there is a window where the edge function is
    // live and the RPC is not. Say so truthfully instead of failing opaquely.
    if (error.code === "PGRST202") {
      console.error("[accountPurge] purge_user_data not deployed yet:", error.message);
      steps.push({
        step: "database",
        ok: false,
        detail: "purge_user_data RPC not deployed yet (PGRST202) — deferring, not failing",
      });
      return { ok: false, notDeployed: true };
    }
    console.error(`[accountPurge] purge_user_data failed for ${userId}:`, error.message);
    steps.push({ step: "database", ok: false, detail: `${error.code ?? "?"}: ${error.message}` });
    return { ok: false, notDeployed: false };
  }

  // A null `error` does NOT mean the write happened — the RPC returns a
  // per-step row-count report precisely so the caller never has to infer it.
  if (!data || typeof data !== "object") {
    steps.push({
      step: "database",
      ok: false,
      detail: "purge_user_data returned no report — treating as not-run",
    });
    return { ok: false, notDeployed: false };
  }

  steps.push({ step: "database", ok: true, detail: JSON.stringify(data) });
  return { ok: true, notDeployed: false };
}

/**
 * The storage paths this user's chat attachments occupy.
 *
 * `message-attachments` is keyed `<job_id>/<sender_id>/<file>`, so the user's
 * own uploads are NOT under a `<uid>/` prefix and no amount of listing will
 * find them. The only pointer is `messages.attachment_url`, and
 * `purge_user_data()` deletes those rows — so this has to run BEFORE the RPC
 * or the files are stranded in storage permanently with nothing left to
 * locate them by. That ordering is the whole reason this function exists
 * separately from the bucket sweep.
 *
 * Read-only and repeatable: on a retry after the rows are already gone it
 * simply returns nothing, and the objects it would have named are gone too.
 */
async function collectMessageAttachments(
  admin: PurgeCapableClient,
  userId: string,
  steps: PurgeStep[],
): Promise<string[]> {
  const res: PostgrestLike<{ attachment_url: string | null }[]> = await admin
    .from("messages")
    .select("attachment_url")
    .eq("sender_id", userId)
    .not("attachment_url", "is", null);

  if (res.error) {
    // Not fatal on its own, but it MUST be visible: proceeding would delete
    // the message rows and orphan whatever they pointed at.
    console.error(`[accountPurge] could not read message attachments for ${userId}:`, res.error.message);
    steps.push({
      step: "message_attachments",
      ok: false,
      detail: `read failed (${res.error.code ?? "?"}: ${res.error.message})`,
    });
    return [];
  }

  const paths: string[] = [];
  let rejected = 0;
  for (const row of res.data ?? []) {
    const url = row.attachment_url;
    if (!url) continue;
    // Stored either as a bare object path or as a full public/signed URL.
    const marker = "/message-attachments/";
    const idx = url.indexOf(marker);
    const raw = idx >= 0 ? url.slice(idx + marker.length).split("?")[0] : url;
    if (!raw) continue;

    // `decodeURIComponent` throws URIError on a malformed `%` escape, and
    // `attachment_url` is client-supplied text. Uncaught, one bad row threw out
    // of this function, out of purgeAccount, and permanently 500'd that user's
    // own account deletion with no way for them to proceed.
    let path: string;
    try {
      path = decodeURIComponent(raw);
    } catch {
      path = raw;
    }

    // The path MUST be `<job_id>/<this user's id>/<file>`.
    //
    // Without this check the removal list was whatever a client had written
    // into `attachment_url`, handed to `storage.remove()` under the
    // SERVICE-ROLE key — which bypasses the storage RLS that otherwise confines
    // a user to their own folder. The `messages` INSERT policy validates
    // `sender_id` and job participation but never the URL, so a user could
    // plant `<other_job>/<other_user>/<file>` in a message they legitimately
    // sent and destroy another party's dispute evidence on the way out.
    // Deleting your account must not be a primitive for deleting someone
    // else's files.
    const segments = path.split("/");
    if (segments.length < 3 || segments[1] !== userId) {
      console.error(
        `[accountPurge] refusing out-of-scope attachment path for ${userId}: ${path.slice(0, 120)}`,
      );
      rejected++;
      continue;
    }
    paths.push(path);
  }
  steps.push({
    step: "message_attachments",
    ok: true,
    detail: rejected > 0
      ? `${paths.length} attachment path(s) queued, ${rejected} rejected as out-of-scope`
      : `${paths.length} attachment path(s) queued for removal`,
  });
  return paths;
}

/**
 * The jobs `purge_user_data()` may DELETE: the ones this user posted that are
 * still unassigned (its step 4a also requires unpaid, unreviewed and
 * unapplied, and skips any a foreign key still holds). Read before the RPC
 * because afterwards nothing names them; which ones actually went is decided
 * afterwards by re-reading, so this may over-collect safely.
 *
 * Never blocks: a failed read is recorded and logged, and the deletion goes
 * ahead — the weekly storage-orphan-sweep is the net for those files.
 */
async function collectDeletableJobs(
  admin: PurgeCapableClient,
  userId: string,
  steps: PurgeStep[],
): Promise<JobMediaOwner[]> {
  const res: PostgrestLike<{ id: string; customer_id: string | null; helper_id: string | null }[]> = await admin
    .from("jobs")
    .select("id, customer_id, helper_id")
    .eq("customer_id", userId)
    .is("helper_id", null)
    .limit(1000);
  if (res.error) {
    console.error(`[accountPurge] could not read deletable jobs for ${userId}:`, res.error.message);
    steps.push({ step: "job_media", ok: false, detail: `job read failed (${res.error.code ?? "?"}: ${res.error.message}) — media of deleted jobs left for the weekly sweep` });
    return [];
  }
  return res.data ?? [];
}

async function removeMediaOfDeletedJobs(
  admin: PurgeCapableClient,
  candidates: JobMediaOwner[],
  steps: PurgeStep[],
): Promise<void> {
  if (candidates.length === 0) {
    if (!steps.some((s) => s.step === "job_media")) {
      steps.push({ step: "job_media", ok: true, detail: "no deletable jobs" });
    }
    return;
  }
  const ids = candidates.map((j) => j.id);
  const still: PostgrestLike<{ id: string }[]> = await admin.from("jobs").select("id").in("id", ids);
  if (still.error) {
    console.error("[accountPurge] could not re-read jobs after purge:", still.error.message);
    steps.push({ step: "job_media", ok: false, detail: `re-read failed (${still.error.message}) — media left for the weekly sweep` });
    return;
  }
  // Only jobs CONFIRMED gone. A job the RPC kept is someone's record: its files stay.
  const kept = new Set((still.data ?? []).map((r) => r.id));
  // A job id that is also a USER id would turn `<jobId>/` into that user's own
  // folder (`proof-photos/<userId>/disputes/…`, `job-photos/<userId>/reviews/…`),
  // and this runs under the service role. Job ids are not guaranteed
  // server-minted, so refuse any that collide with a profile.
  const goneIds = ids.filter((id) => !kept.has(id));
  const collide: PostgrestLike<{ user_id: string }[]> = goneIds.length
    ? await admin.from("profiles").select("user_id").in("user_id", goneIds)
    : { data: [], error: null };
  if (collide.error) {
    console.error("[accountPurge] could not check job ids against users:", collide.error.message);
    steps.push({ step: "job_media", ok: false, detail: `user-id collision check failed (${collide.error.message}) — media left for the weekly sweep` });
    return;
  }
  const userIds = new Set((collide.data ?? []).map((r) => r.user_id));
  if (userIds.size > 0) {
    console.error(`[accountPurge] ${userIds.size} deleted job id(s) equal a user id; their media is NOT removed`);
  }
  const gone = candidates.filter((j) => !kept.has(j.id) && !userIds.has(j.id));
  if (gone.length === 0) {
    steps.push({ step: "job_media", ok: true, detail: "no jobs were deleted" });
    return;
  }
  // Bounded: ~6 list calls per job run before auth.admin.deleteUser, inside the
  // edge function's time limit. Beyond the cap, the weekly sweep takes the rest.
  const JOB_MEDIA_CAP = 25;
  const { removed, failures } = await removeJobMedia(admin, gone.slice(0, JOB_MEDIA_CAP), "accountPurge");
  if (gone.length > JOB_MEDIA_CAP) {
    failures.push(`${gone.length - JOB_MEDIA_CAP} deleted job(s) over the ${JOB_MEDIA_CAP}-job cap left for the weekly sweep`);
  }
  steps.push({
    step: "job_media",
    ok: failures.length === 0,
    detail: failures.length === 0
      ? `removed ${removed} object(s) of ${gone.length} deleted job(s)`
      : `removed ${removed} object(s) of ${gone.length} deleted job(s); failures (not blocking): ${failures.join("; ")}`,
  });
}

/**
 * Q2307: clear the member's own words and photos from the Declutter orders that outlive the account (the order and
 * its money rows stay for the other side, the party column goes NULL with the auth user). Fails closed: a deletion
 * never completes with the words still there. Not deployed yet (PGRST202) also stops the deletion, and is retried.
 */
/**
 * Q1791 (App Store Review 5.1.1(v)): revoke the member's Sign in with Apple
 * token before the auth row goes, so Apple stops treating the app as linked.
 * Recorded as a step but NOT part of the gate in purgeAccount: a deletion is
 * the member's legal right, and refusing it because Apple's endpoint (or a
 * missing key) is down would strand them; a failure logs loudly instead. The
 * token row CASCADEs with the auth row either way, so no Apple token outlives
 * the account.
 */
async function revokeAppleTokenIfAny(admin: PurgeCapableClient, userId: string, steps: PurgeStep[]): Promise<void> {
  const out = await revokeAppleSignIn(admin, userId, appleSignInKeyFromEnv((n) => Deno.env.get(n)));
  if (out.status === "failed") {
    console.error(`[accountPurge] Apple token revoke failed for ${userId}: ${out.detail}`);
    steps.push({ step: "apple_revoke", ok: false, detail: out.detail });
    return;
  }
  steps.push({ step: "apple_revoke", ok: true, detail: out.status });
}

async function scrubDeclutterSales(admin: PurgeCapableClient, userId: string, steps: PurgeStep[]): Promise<boolean> {
  const { data, error }: PostgrestLike<Record<string, number>> = await admin.rpc("declutter_scrub_member", { p_user_id: userId });
  if (error) {
    console.error(`[accountPurge] declutter_scrub_member failed for ${userId}:`, error.message);
    steps.push({ step: "declutter_scrub", ok: false, detail: `${error.code ?? "?"}: ${error.message}` });
    return false;
  }
  if (!data || typeof data !== "object") {
    steps.push({ step: "declutter_scrub", ok: false, detail: "declutter_scrub_member returned no report" });
    return false;
  }
  steps.push({ step: "declutter_scrub", ok: true, detail: JSON.stringify(data) });
  return true;
}

/**
 * Run every pre-deletion step. Call this immediately before
 * `auth.admin.deleteUser`; see `describeDeleteError` for the failure of that
 * final call.
 */
export async function purgeAccount(
  admin: PurgeCapableClient,
  userId: string,
): Promise<PurgeOutcome> {
  const steps: PurgeStep[] = [];

  if (!UUID_RE.test(userId)) {
    return {
      ok: false,
      steps: [{ step: "input", ok: false, detail: "userId is not a UUID" }],
      reason: "database_failed",
      userMessage:
        "We couldn't finish removing your data. Please try again, and contact " +
        "admin@louisianahelpr.com if it keeps failing.",
    };
  }

  await cancelStripeSubscription(admin, userId, steps);
  // Read the chat-attachment paths BEFORE the RPC deletes the rows that name
  // them (see collectMessageAttachments).
  const attachmentPaths = await collectMessageAttachments(admin, userId, steps);
  // The row lets go of the avatar before the object goes (see clearAvatarPointer).
  await clearAvatarPointer(admin, userId, steps);
  const storageOk = await purgeIdentityStorage(admin, userId, steps, [
    { bucket: "message-attachments", paths: attachmentPaths },
  ]);
  // BEFORE purgeDatabaseRows, always. It reads `profiles.email`, which step 4e
  // of `purge_user_data` nulls — reversing these two lines turns the retention
  // into a silent no-op that returns 0 and no error. See retainBanIfAny.
  const banRetained = await retainBanIfAny(admin, userId, steps);
  // Q1791: while the token row still exists (purgeDatabaseRows and the auth delete come after).
  await revokeAppleTokenIfAny(admin, userId, steps);
  // Read BEFORE the RPC: purge_user_data DELETES some of this user's jobs, and
  // afterwards nothing names them (see collectDeletableJobs).
  const deletableJobs = await collectDeletableJobs(admin, userId, steps);
  // Q2307: the member's finished Declutter sales stay for the other side as "Former member", money only: their words
  // and photos on those orders go first (declutter_scrub_member, 20261021204947). Part of the gate below.
  const declutterScrubbed = await scrubDeclutterSales(admin, userId, steps);
  const db = await purgeDatabaseRows(admin, userId, steps);
  if (db.ok) await removeMediaOfDeletedJobs(admin, deletableJobs, steps);
  const stripeOk = steps.find((s) => s.step === "stripe")?.ok !== false;
  const attachmentsOk = steps.find((s) => s.step === "message_attachments")?.ok !== false;

  // Storage is allowed to be the thing that stops us, and deliberately so: if
  // we cannot prove the ID document is gone, completing the deletion would
  // orphan it forever with no user left to ask about it. Better to refuse,
  // tell the truth, and let the retry succeed. The database step is the same —
  // deleting the auth row without it would strand PII in the no-FK tables.
  // The stripe step is part of the gate, not advisory. It used to be ignored
  // here: a genuine cancel failure let the deletion proceed, the `profiles`
  // row then CASCADEd away carrying `stripe_subscription_id` with it, and the
  // account billed forever with nothing left to remediate from. The delete
  // dialog now tells the user "your membership stops billing" — this is what
  // makes that sentence true rather than aspirational.
  //
  // The ban-retention step joins that gate for the same reason, one step
  // earlier in the argument: the auth delete is what frees the email and
  // CASCADEs `ban_status` away, so if we cannot first record that this account
  // was banned, completing the deletion converts a suspension into a clean
  // slate with nothing left to reconstruct it from. It fails closed ONLY for
  // an account that is actually banned — see retainBanIfAny.
  if (!storageOk || !db.ok || !stripeOk || !attachmentsOk || !banRetained || !declutterScrubbed) {
    return {
      ok: false,
      steps,
      reason: db.notDeployed
        ? "rpc_not_deployed"
        : !stripeOk
        ? "stripe_failed"
        : !storageOk || !attachmentsOk
        ? "storage_failed"
        : "database_failed",
      userMessage:
        "We couldn't finish removing your data, so we've stopped rather than " +
        "leave your account half-deleted. Nothing is lost — please try again " +
        "in a few minutes, and contact admin@louisianahelpr.com if it keeps failing.",
    };
  }

  return { ok: true, steps };
}

/**
 * Turn a failure from `auth.admin.deleteUser` into something a person can act
 * on.
 *
 * The specific thing this replaces: the raw Postgres text
 *   update or delete on table "users" violates foreign key constraint
 *   "jobs_helper_id_fkey" on table "jobs"
 * was being passed straight through to the account-deletion dialog. That is a
 * permanent, unexplained refusal of a legally-required capability — the user
 * has no idea what it means and no way to proceed. After the retention-policy
 * migration a 23503 should be unreachable; if one ever appears again it means
 * a NEW foreign key was added without a delete rule, which is an us-problem,
 * so the message says so and routes the person to support rather than blaming
 * them or leaving them stuck.
 */
export function describeDeleteError(message: string): string {
  if (/23503|violates foreign key constraint/i.test(message)) {
    return (
      "Something on our side is holding a reference to your account, so we " +
      "couldn't finish deleting it. This is our bug, not something you did. " +
      "We've logged it — email admin@louisianahelpr.com and we'll complete " +
      "the deletion manually."
    );
  }
  return "We couldn't finish deleting your account. Please try again, or email admin@louisianahelpr.com.";
}
