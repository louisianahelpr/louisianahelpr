/**
 * An error whose message was WRITTEN FOR PEOPLE and may be shown to the caller.
 *
 * Edge functions throw two kinds of error into the same top-level catch: the
 * sentences we wrote on purpose ("Tips must be between $1 and $1,000", "Not
 * authorized") and raw upstream detail (Stripe ids, PostgREST column names).
 * EF-5 (2026-09-15) forbade echoing `err.message`, and create-payment then
 * replaced EVERY error with one fixed sentence (5152014f3, 2026-09-22) — which
 * also erased the intended ones, so a tipper out of range was told "We couldn't
 * complete that payment step" (vitest caught it: 20 assertions red).
 *
 * The rule: throw `PublicError` for a sentence meant for the caller; anything
 * else is raw and gets the fallback. `publicErrorMessage` is the ONE sanctioned
 * way a caught error reaches a response body — the EF-5 leak detector
 * (src/test/edge/error-leak-EF5.test.ts) exempts exactly this call.
 */
export class PublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicError";
  }
}

export function publicErrorMessage(err: unknown, fallback: string): string {
  return err instanceof PublicError ? err.message : fallback;
}
