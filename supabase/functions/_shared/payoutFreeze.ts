/**
 * Q1221 (owner decision 2026-10-05): while a payout hold is active, the held
 * Helpr's Stripe AUTOMATIC payouts are frozen (Connect payout schedule set to
 * manual) and their previous schedule is put back when the hold lifts.
 *
 * public.payout_schedule_freezes (migration 20261006020751) says what Stripe
 * must be told; triggers on payout_holds move its state. This module does the
 * telling, for one Helpr at a time, and is the only code that changes a payout
 * schedule because of a hold.
 *
 * INVARIANTS
 *   1. Stripe is set to manual only AFTER the schedule to restore is saved on
 *      the row (savePrior). A pause that succeeded at Stripe and then failed to
 *      record itself can therefore always be undone.
 *   2. The row is deleted only AFTER the restore succeeded at Stripe. A failed
 *      restore leaves it in restore_requested, where the sweep retries and
 *      pages: nobody is left on manual with nothing remembering why.
 *   3. Every state move is a compare-and-set on the state this run read. If
 *      another run (the client's call, the 10-minute sweep) moved it first,
 *      this run re-reads and reconciles to the NEW state, using what it already
 *      did at Stripe (it never drops a pause it made).
 *   4. Idempotent: running it again on a settled row does nothing; Stripe calls
 *      carry an idempotency key per request (helper, target, requested_at).
 *
 * Pure: Stripe and the database come in as ports, so the state machine is
 * unit-tested with fakes (src/test/payoutFreeze.test.ts). The supabase-backed
 * store is supabaseFreezeStore below; the edge function is
 * supabase/functions/payout-hold-stripe-sync.
 */
import { caughtMessage } from "./caughtMessage.ts";

export type FreezeState = "pause_requested" | "paused" | "restore_requested";

/** Stripe's Account.settings.payouts.schedule, as far as we store and restore it. */
export interface PayoutSchedule {
  interval: string;
  delay_days?: number | string | null;
  weekly_anchor?: string | null;
  monthly_anchor?: number | null;
}

export interface FreezeRow {
  helper_id: string;
  state: FreezeState;
  stripe_account_id: string | null;
  prior_schedule: PayoutSchedule | null;
  requested_by: string | null;
  requested_at: string;
  /** Failed attempts on THIS request; part of every Stripe idempotency key, so a retry is a new key. */
  attempts: number;
}

export interface FreezeStore {
  /** The row, or null when there is none. Throws when it cannot be read. */
  get(helperId: string): Promise<FreezeRow | null>;
  /** The Helpr's Connect account on file, or null. Throws when it cannot be read. */
  accountIdOf(helperId: string): Promise<string | null>;
  /**
   * Save the schedule to restore, only while still pause_requested and none is
   * saved. TRUE only when this call wrote the row; false when the state moved
   * or a prior was already there (the caller re-reads). Throws on error.
   */
  savePrior(helperId: string, accountId: string, prior: PayoutSchedule): Promise<boolean>;
  /** CAS pause_requested -> paused. False when the state had moved. Throws on error. */
  markPaused(helperId: string, accountId: string | null): Promise<boolean>;
  /** CAS delete while restore_requested. False when the state had moved. Throws on error. */
  finishRestore(helperId: string): Promise<boolean>;
  /** Count a failed attempt on the row (while still in `state`); returns the new attempt count. */
  recordFailure(helperId: string, state: FreezeState, message: string): Promise<number>;
  /** Stamp a 'paused' row as checked at Stripe just now. Throws on error. */
  markVerified(helperId: string): Promise<void>;
}

export interface StripeSchedulePort {
  /** The account's current payout schedule. Throws (Stripe error) when it cannot be read. */
  retrieveSchedule(accountId: string): Promise<PayoutSchedule | null>;
  setSchedule(accountId: string, schedule: PayoutSchedule, idempotencyKey: string): Promise<void>;
  /** Is this Stripe error "the account no longer exists / is not usable under this key"? */
  isAccountGone(err: unknown): boolean;
}

export type FreezeOutcome =
  | { kind: "paused"; changed: boolean; note?: string; drifted?: boolean }
  | { kind: "restored"; changed: boolean; note?: string }
  | { kind: "nothing"; note: string }
  | { kind: "failed"; state: FreezeState | null; message: string; attempts: number | null; requestedBy: string | null };

const MANUAL: PayoutSchedule = { interval: "manual" };

/** The update payload that puts `prior` back: only the fields Stripe accepts for its interval. */
export function restorePayload(prior: PayoutSchedule): PayoutSchedule {
  const out: PayoutSchedule = { interval: prior.interval };
  if (prior.interval !== "manual" && (typeof prior.delay_days === "number" || prior.delay_days === "minimum")) {
    out.delay_days = prior.delay_days;
  }
  if (prior.interval === "weekly" && prior.weekly_anchor) out.weekly_anchor = prior.weekly_anchor;
  if (prior.interval === "monthly" && typeof prior.monthly_anchor === "number") out.monthly_anchor = prior.monthly_anchor;
  return out;
}

/**
 * One key per (request, target, attempt). The same attempt replays safely; a
 * retry after a failure (attempts bumped by recordFailure) is a NEW key, so
 * Stripe never answers it with the cached error of the failed attempt.
 */
function keyFor(helperId: string, target: string, requestedAt: string, attempt: number): string {
  return `payout-freeze:${helperId}:${target}:${requestedAt}:a${attempt}`;
}


/** Bring Stripe in line with this Helpr's freeze row. Never throws: a failure is an outcome. */
export async function reconcilePayoutFreeze(
  helperId: string,
  store: FreezeStore,
  stripe: StripeSchedulePort,
): Promise<FreezeOutcome> {
  // What THIS run did at Stripe, so a lost compare-and-set never drops it.
  // Set ONLY when this run itself moved the schedule to manual.
  let pausedHere: { accountId: string; prior: PayoutSchedule; requestedAt: string; attempt: number } | null = null;
  let lastState: FreezeState | null = null;
  let requestedBy: string | null = null;

  try {
    for (let pass = 0; pass < 4; pass++) {
      const row = await store.get(helperId);

      if (!row) {
        if (pausedHere) {
          // Our pause raced a release that another run already finished: no
          // hold exists any more, so put back what we found.
          await stripe.setSchedule(pausedHere.accountId, restorePayload(pausedHere.prior), keyFor(helperId, "undo", pausedHere.requestedAt, pausedHere.attempt));
          return { kind: "restored", changed: true, note: "undid a pause that raced a release" };
        }
        return { kind: "nothing", note: "no freeze row" };
      }
      lastState = row.state;
      requestedBy = row.requested_by;

      if (row.state === "paused") {
        // INVARIANT 5: "paused" is CHECKED, not trusted. A restore by another
        // run (or this one, before a re-hold landed and the row went back to
        // paused) can leave Stripe on its old schedule while the row says
        // paused. The row must be true at Stripe, so it is read back and put
        // to manual again if it drifted; the caller pages on `drifted`.
        if (row.stripe_account_id) {
          let current: PayoutSchedule | null = null;
          try {
            current = await stripe.retrieveSchedule(row.stripe_account_id);
          } catch (err) {
            if (!stripe.isAccountGone(err)) throw err;
          }
          if (current && current.interval !== "manual") {
            // A fresh key: a drift is a new event, and a replayed key would
            // hand back the earlier answer without changing anything.
            await stripe.setSchedule(row.stripe_account_id, MANUAL, keyFor(helperId, "repause", new Date().toISOString(), row.attempts));
            await store.markVerified(helperId);
            return { kind: "paused", changed: true, drifted: true, note: `Stripe was on ${current.interval} while the hold was paused; set to manual again` };
          }
          await store.markVerified(helperId);
        }
        return { kind: "paused", changed: pausedHere !== null };
      }

      if (row.state === "pause_requested") {
        const accountId = await store.accountIdOf(helperId);
        if (!accountId) {
          // No Connect account: nothing can pay out automatically. A later
          // account cannot receive a transfer while held (Q764), so it has no
          // balance to pay out either.
          if (await store.markPaused(helperId, null)) {
            return { kind: "paused", changed: false, note: "no Connect account on file" };
          }
          continue;
        }

        let current: PayoutSchedule | null;
        try {
          current = await stripe.retrieveSchedule(accountId);
        } catch (err) {
          if (!stripe.isAccountGone(err)) throw err;
          if (await store.markPaused(helperId, null)) {
            return { kind: "paused", changed: false, note: "the Connect account on file no longer exists" };
          }
          continue;
        }
        if (!current || typeof current.interval !== "string") {
          throw new Error(`Stripe returned no payout schedule for ${accountId}`);
        }

        // INVARIANT 1: the schedule to restore is ON THE ROW before Stripe is
        // touched. A prior already saved (a re-hold before a restore ran)
        // wins: it is the schedule from before the FIRST hold. When this run
        // saves it, the save must have written the row (a release between
        // our read and the save moves the state, and the save then writes
        // nothing): anything else re-reads and reconciles instead.
        if (!row.prior_schedule) {
          if (!(await store.savePrior(helperId, accountId, current))) continue;
        }
        const saved = await store.get(helperId);
        if (!saved || saved.state !== "pause_requested" || !saved.prior_schedule) continue;

        let changed = false;
        if (current.interval !== "manual") {
          await stripe.setSchedule(accountId, MANUAL, keyFor(helperId, "manual", saved.requested_at, saved.attempts));
          changed = true;
          pausedHere = { accountId, prior: saved.prior_schedule, requestedAt: saved.requested_at, attempt: saved.attempts };
        }

        if (await store.markPaused(helperId, accountId)) {
          return { kind: "paused", changed: changed || pausedHere !== null };
        }
        continue; // the state moved under us: reconcile to the new one
      }

      // restore_requested
      const prior = row.prior_schedule ?? pausedHere?.prior ?? null;
      const accountId = row.stripe_account_id ?? pausedHere?.accountId ?? null;
      let note: string | undefined;
      if (prior && accountId) {
        try {
          await stripe.setSchedule(accountId, restorePayload(prior), keyFor(helperId, `restore-${prior.interval}`, row.requested_at, row.attempts));
        } catch (err) {
          if (!stripe.isAccountGone(err)) throw err;
          note = "the Connect account no longer exists; nothing to restore";
        }
      } else {
        note = "nothing was paused";
      }
      // INVARIANT 2: deleted only after Stripe took the restore.
      if (await store.finishRestore(helperId)) {
        return { kind: "restored", changed: !!(prior && accountId) && !note, note };
      }
      // A re-hold landed meanwhile: loop, and pause again.
    }
    throw new Error("the freeze state kept changing under this run; the sweep will retry");
  } catch (err) {
    const message = caughtMessage(err);
    let attempts: number | null = null;
    if (lastState && lastState !== "paused") {
      try {
        attempts = await store.recordFailure(helperId, lastState, message);
      } catch {
        // Counting the attempt is bookkeeping; the outcome below still carries
        // the failure to the caller, which pages.
        attempts = null;
      }
    }
    return { kind: "failed", state: lastState, message, attempts, requestedBy };
  }
}

// ── The supabase-backed store ──────────────────────────────────────────────

type Result<T> = { data: T; error: { message?: string; code?: string } | null };
// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

function check<T>(res: Result<T>, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? "database error"}`);
  return res.data;
}

export function supabaseFreezeStore(db: Db): FreezeStore {
  const T = "payout_schedule_freezes";
  return {
    async get(helperId) {
      const row = check<(Omit<FreezeRow, "state"> & { freeze_state: FreezeState }) | null>(
        await db.from(T)
          .select("helper_id, freeze_state, stripe_account_id, prior_schedule, requested_by, requested_at, attempts")
          .eq("helper_id", helperId)
          .maybeSingle(),
        "read the freeze row",
      );
      if (!row) return null;
      const { freeze_state, ...rest } = row;
      return { ...rest, attempts: rest.attempts ?? 0, state: freeze_state };
    },
    async accountIdOf(helperId) {
      const row = check<{ stripe_account_id: string | null } | null>(
        await db.from("profiles").select("stripe_account_id").eq("user_id", helperId).maybeSingle(),
        "read the Helpr's Connect account",
      );
      const id = row?.stripe_account_id;
      return typeof id === "string" && id.trim() !== "" ? id : null;
    },
    async savePrior(helperId, accountId, prior) {
      // Zero rows is legitimate (the state moved, or a prior is already
      // saved) and is reported, so the caller never touches Stripe on it.
      const rows = check<Array<{ helper_id: string }> | null>(
        await db.from(T)
          .update({ prior_schedule: prior, stripe_account_id: accountId, updated_at: new Date().toISOString() })
          .eq("helper_id", helperId)
          .eq("freeze_state", "pause_requested")
          .is("prior_schedule", null)
          .select("helper_id"),
        "save the schedule to restore",
      );
      return (rows?.length ?? 0) === 1;
    },
    async markPaused(helperId, accountId) {
      const rows = check<Array<{ helper_id: string }> | null>(
        await db.from(T)
          .update({
            freeze_state: "paused",
            stripe_account_id: accountId,
            attempts: 0,
            freeze_error: null,
            alerted_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("helper_id", helperId)
          .eq("freeze_state", "pause_requested")
          .select("helper_id"),
        "record the pause",
      );
      return (rows?.length ?? 0) === 1;
    },
    async finishRestore(helperId) {
      const rows = check<Array<{ helper_id: string }> | null>(
        await db.from(T).delete().eq("helper_id", helperId).eq("freeze_state", "restore_requested").select("helper_id"),
        "record the restore",
      );
      return (rows?.length ?? 0) === 1;
    },
    async markVerified(helperId) {
      // Zero rows is legitimate (the state moved since the check).
      check(
        await db.from(T)
          .update({ verified_at: new Date().toISOString() })
          .eq("helper_id", helperId)
          .eq("freeze_state", "paused")
          .select("helper_id"),
        "stamp the Stripe check",
      );
    },
    async recordFailure(helperId, state, message) {
      const current = check<{ attempts: number } | null>(
        await db.from(T).select("attempts, freeze_error").eq("helper_id", helperId).eq("freeze_state", state).maybeSingle(),
        "read the attempt count",
      );
      const next = (current?.attempts ?? 0) + 1;
      check(
        await db.from(T)
          .update({ attempts: next, freeze_error: message.slice(0, 1000), updated_at: new Date().toISOString() })
          .eq("helper_id", helperId)
          .eq("freeze_state", state)
          .select("helper_id"),
        "record the failed attempt",
      );
      return next;
    },
  };
}
