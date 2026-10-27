/**
 * Helpr Guarantee (owner 2026-10-27): the plain words for every code the four guarantee RPCs raise
 * (migration 20261027200455_helpr_guarantee.sql), at their call sites. Kept out of
 * src/lib/lifecycleErrors.ts (the shared signed-in chunk, Q178): only the guarantee panel reads it.
 *
 * EXACT, both ways: src/test/rpcErrorCopyCoverage.test.ts reads each RPC's codes against this table.
 */

const COMMON = {
  not_signed_in: "Please sign in again.",
  account_restricted: "Your account is restricted, so you can't do this right now.",
} as const;

const ANSWER = {
  guarantee_not_yours: "This request isn't yours to answer.",
  guarantee_answer_closed: "This request has moved on. Refresh the job to see where it stands.",
} as const;

export const GUARANTEE_RPC_ERROR_COPY = {
  rpc_guarantee_open: {
    ...COMMON,
    guarantee_not_your_job: "Only the person who posted this job can ask for a fix.",
    guarantee_already_used: "You already used the Helpr Guarantee on this job.",
    guarantee_not_available: "The Helpr Guarantee is for a finished job with one Helpr and no dispute.",
    guarantee_window_closed: "The Helpr Guarantee is open for 48 hours after a job is done, and that time has passed.",
    guarantee_already_paid: "Your Helpr has already been paid for this job, so the Helpr Guarantee can't hold it. Contact support.",
    guarantee_needs_note: "Say what wasn't done right, in a sentence or two.",
    guarantee_note_too_long: "Keep it to 1,000 characters.",
    guarantee_too_many_photos: "Add up to 6 photos.",
    guarantee_bad_photo: "One of the photos didn't upload. Remove it and add it again.",
  },
  rpc_guarantee_helpr_answer: {
    ...COMMON,
    ...ANSWER,
    guarantee_bad_answer: "Pick Accept fix or Can't fix.",
    guarantee_bad_fix_date: "Pick a day from today to 3 days from now.",
  },
  rpc_guarantee_mark_fixed: {
    ...COMMON,
    ...ANSWER,
  },
  rpc_guarantee_poster_answer: {
    ...COMMON,
    ...ANSWER,
    guarantee_bad_answer: "Pick It's fixed or Still not right.",
    guarantee_needs_note: "Say what is still not right, in a sentence or two.",
    guarantee_note_too_long: "Keep it to 1,000 characters.",
  },
} satisfies Record<string, Record<string, string>>;

export type GuaranteeRpc = keyof typeof GUARANTEE_RPC_ERROR_COPY;

/** Words for an error a guarantee RPC returned, or null when it is not a code we have words for (whole-token match). */
export function rpcErrorMessage(rpc: GuaranteeRpc, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  if (!raw) return null;
  const table: Record<string, string> = GUARANTEE_RPC_ERROR_COPY[rpc];
  for (const code of Object.keys(table).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}
