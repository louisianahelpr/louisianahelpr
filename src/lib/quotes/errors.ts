import { EscrowCheckoutError } from "@/lib/escrowCheckout";
import { QUOTE_ERROR_COPY } from "./errorCopy";
import { MAX_JOB_BUDGET_DOLLARS, MIN_JOB_BUDGET_DOLLARS, formatDollarsWhole } from "@/lib/moneyLimits";

export { QUOTE_ERROR_COPY };

/**
 * Q1875: book_accepted_quote and switch_quote_request_to_set_price create the
 * job (quote_insert_job), so the jobs INSERT triggers can refuse them too:
 * validate_job_budget (the poster's own price), enforce_open_job_limit and
 * the per-table email gate. Their messages are not quote codes, so
 * QUOTE_ERROR_COPY (exact against the quotes migration) cannot hold them.
 * job_start_too_soon, under_18 and account_restricted already have lines there.
 * EXACT: src/lib/quotes/errors.test.ts reads every RAISE of every jobs
 * BEFORE INSERT trigger and fails on one with no words here and no reason it
 * cannot be reached from quote_insert_job.
 */
export const JOB_INSERT_REFUSAL_COPY: ReadonlyArray<{ match: RegExp; copy: string }> = [
  { match: /^Minimum budget is \$/, copy: `Set a price of at least ${formatDollarsWhole(MIN_JOB_BUDGET_DOLLARS)}.` },
  { match: /^Maximum budget is \$/, copy: `A job can be up to ${formatDollarsWhole(MAX_JOB_BUDGET_DOLLARS)}. Split a bigger project into separate jobs.` },
  { match: /maximum of 5 open jobs at a time/, copy: "You can have up to 5 open jobs at a time. Close one, or wait for one to be booked, then try again." },
  { match: /^email_unconfirmed\b/, copy: "Confirm your email address first: open the link we emailed you, then try again." },
];

/** The member-facing words for a quote RPC failure (or the escrow checkout's refusal). */
export function quoteErrorMessage(err: unknown): string {
  if (err instanceof EscrowCheckoutError) return `Couldn't start payment: ${err.message}`;
  // The words src/lib/quotes/api.ts attached from RPC_ERROR_COPY at the call.
  const attached = (err as { userMessage?: unknown } | null)?.userMessage;
  if (typeof attached === "string" && attached) return attached;
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const code = raw.trim();
  if (QUOTE_ERROR_COPY[code]) return QUOTE_ERROR_COPY[code];
  if (/price_cents_check/.test(code)) return "Quotes are whole dollars from $10 to $1,000.";
  for (const r of JOB_INSERT_REFUSAL_COPY) if (r.match.test(code)) return r.copy;
  // The contact-leak trigger's sentence is written for the member already.
  if (/detected/i.test(code) && code.length < 300) return code;
  return "Something went wrong. Please try again.";
}
