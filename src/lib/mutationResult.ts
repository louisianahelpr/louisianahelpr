/**
 * unwrapMutation — make "the write silently did nothing" a real failure.
 *
 * Sibling of `unwrap()` in `supabaseResult.ts`. Where `unwrap()` guards the
 * *read* path (never drop the `error` half), this guards the *write* path,
 * which has a second, quieter failure mode:
 *
 *   An UPDATE / DELETE that matches ZERO rows is not an error in Postgres.
 *   RLS filtered the row out, the id was stale, a `BEFORE UPDATE` trigger
 *   reverted it, or a guard predicate (`.eq("status", "pending")`) no longer
 *   held — and PostgREST returns `{ data: [], error: null }`. So
 *   `const { error } = await supabase.from(X).update(…)` proceeds down the
 *   success path, fires the confetti, and the row never changed.
 *
 * Every serious bug found in the last audit was that exact shape: escrow
 * releases, ban ladders, recurring schedules, admin queue resolutions.
 *
 *   const [job] = unwrapMutation(
 *     await supabase
 *       .from("jobs")
 *       .update({ status: "completed" })
 *       .eq("id", jobId)
 *       .eq("status", "in_progress")
 *       .select("id"),        // ← required: without it the row count is invisible
 *     { action: "mark this job complete" },
 *   );
 *
 * Three outcomes, three different behaviours:
 *
 *   • Supabase returned an error  → rethrown exactly like `unwrap()` does
 *     (network / permission / constraint — the message is usually real).
 *   • `data` is null/undefined    → the caller forgot `.select(…)`, so the row
 *     count was never observable. Throws `MissingRowCountError`: a programmer
 *     bug, caught in the first click rather than in production a month later.
 *   • `data` is `[]` (or shorter than `min`) → the write was silently
 *     rejected. Throws `WriteRejectedError` AND `report()`s it, so it is
 *     visible in `error_logs` / Sentry rather than only in a toast the user
 *     dismissed.
 *
 * Use `mutationErrorMessage(err, fallback)` in the `catch` to get human copy:
 * a silent rejection deserves different words ("this job already moved on")
 * than a transport failure ("couldn't reach the server").
 */

import { report } from "./errorLogger";
import { unwrap } from "./supabaseResult";

/** The write was accepted by Postgres but changed nothing. */
export class WriteRejectedError extends Error {
  readonly name = "WriteRejectedError";
  /** Plain-language copy safe to show a user. */
  readonly userMessage: string;
  /** How many rows actually came back. */
  readonly rowsAffected: number;
  /** How many the caller required. */
  readonly rowsExpected: number;

  constructor(userMessage: string, rowsAffected: number, rowsExpected: number) {
    super(
      `Write affected ${rowsAffected} row(s), expected at least ${rowsExpected}. ` +
        "Most likely RLS, a stale id, or a guard predicate that no longer holds.",
    );
    this.userMessage = userMessage;
    this.rowsAffected = rowsAffected;
    this.rowsExpected = rowsExpected;
  }
}

/** The caller omitted `.select(…)`, so no row count could be observed. */
export class MissingRowCountError extends Error {
  readonly name = "MissingRowCountError";

  constructor(action: string) {
    super(
      `unwrapMutation("${action}") received no rows array — add .select("id") to the ` +
        "mutation so the affected-row count is observable.",
    );
  }
}

export interface MutationExpectation {
  /**
   * What the user was trying to do, as an infinitive phrase in plain words:
   * "release this payment", "ban this account". Used in the monitoring
   * breadcrumb and in the default user-facing copy — keep it human.
   */
  action: string;
  /**
   * Copy shown to the user when the write was silently rejected. Defaults to
   * a sentence built from `action`. Override when you can say something more
   * useful ("This job was already cancelled by the poster.").
   */
  rejectedMessage?: string;
  /** Minimum rows the caller requires. Default 1. */
  min?: number;
  /** Extra breadcrumbs for the monitoring report (ids, statuses — no PII). */
  context?: Record<string, unknown>;
}

/** Shape of a PostgREST mutation that ended in `.select(…)`. */
type MutationResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Assert a mutation actually touched rows, and return them.
 *
 * @throws the Supabase error, `MissingRowCountError`, or `WriteRejectedError`.
 */
export function unwrapMutation<T>(result: MutationResult<T>, expect: MutationExpectation): T[] {
  const { action, min = 1, rejectedMessage, context } = expect;

  // Real Supabase/PostgREST failure — behave exactly like unwrap().
  const rows = unwrap(result);

  if (!Array.isArray(rows)) {
    // No `.select()` on the mutation: `data` came back null. Nothing can be
    // asserted, so refuse rather than pretend the write landed.
    const bug = new MissingRowCountError(action);
    report(bug, {
      severity: "error",
      tags: { kind: "mutation_missing_select" },
      context: { action, ...context },
    });
    throw bug;
  }

  if (rows.length < min) {
    const rejection = new WriteRejectedError(
      rejectedMessage ?? defaultRejectedMessage(action),
      rows.length,
      min,
    );
    // The whole point: a silent rejection must be observable in production,
    // not just thrown into a catch block that shows a toast.
    report(rejection, {
      severity: "error",
      tags: { kind: "mutation_rejected" },
      context: { action, rowsAffected: rows.length, rowsExpected: min, ...context },
    });
    throw rejection;
  }

  return rows;
}

/**
 * `unwrapMutation` for the common case of exactly one row — returns the row
 * itself instead of a one-element array.
 */
export function unwrapMutationRow<T>(result: MutationResult<T>, expect: MutationExpectation): T {
  return unwrapMutation(result, { ...expect, min: 1 })[0];
}

/** True when `err` is a silently-rejected write rather than a transport error. */
export function isWriteRejected(err: unknown): err is WriteRejectedError {
  return err instanceof WriteRejectedError;
}

/**
 * Human copy for a failed mutation — the counterpart to
 * `functionErrorMessage()` for table writes.
 *
 * A silent rejection gets its own sentence (the server was reachable, the row
 * just wasn't yours / wasn't in that state any more); anything else falls back
 * to `fallback` so a raw PostgREST code never reaches a user.
 */
export function mutationErrorMessage(
  err: unknown,
  fallback = "Couldn't save that change — please try again.",
): string {
  if (isWriteRejected(err)) return err.userMessage;
  if (err instanceof MissingRowCountError) return fallback;
  return fallback;
}

function defaultRejectedMessage(action: string): string {
  return `Couldn't ${action} — it may have already changed. Refresh and try again.`;
}
