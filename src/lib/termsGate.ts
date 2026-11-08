/**
 * The server refuses a money or commitment action from a member who has not
 * accepted the current Terms (20261108154435_terms_accepted_before_commitments
 * at the table, supabase/functions/_shared/requireCurrentTerms.ts in the edge
 * functions). This is the app's half: every Supabase request goes through
 * `termsGateFetch` (src/integrations/supabase/client.ts). When one comes back
 * refused with `terms_not_accepted`, it asks the re-agree dialog to open
 * (TermsReconsentMount listens), waits for the member to agree, and sends the
 * SAME request once more, so the screen that asked gets the real answer and
 * the member never has to press their button twice.
 *
 * Safe to send again: a refused request changed nothing. The table check
 * raises inside the statement (the whole transaction rolls back) and the edge
 * functions refuse before any write or Stripe call.
 *
 * Never waits forever: with no dialog listening (signed out, banned, an
 * unconfirmed email, or tests) the refusal is returned as it came. If the
 * dialog does not show within DIALOG_SHOW_MS (its chunk failed to load, or
 * this build thinks the member is current) the refusal is returned too. It
 * retries once only, so an old build whose own version is behind the server's
 * cannot loop.
 *
 * No imports: this module is in the boot bundle with the Supabase client.
 * Guard: src/test/termsGate.test.ts.
 */
const TERMS_NOT_ACCEPTED = "terms_not_accepted";
const DIALOG_SHOW_MS = 10_000;

type Listener = () => void;
let listener: Listener | null = null;
let pending: Promise<boolean> | null = null;
let settle: ((agreed: boolean) => void) | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;

/** True when a response body says the server refused for stale Terms. */
function isTermsRefusalBody(text: string): boolean {
  if (!text.includes(TERMS_NOT_ACCEPTED)) return false;
  try {
    const body = JSON.parse(text) as { message?: unknown; code?: unknown };
    return body?.message === TERMS_NOT_ACCEPTED || body?.code === TERMS_NOT_ACCEPTED;
  } catch {
    // Not JSON: not one of our refusals (PostgREST and the edge functions both answer JSON).
    return false;
  }
}

function finish(agreed: boolean): void {
  if (showTimer) clearTimeout(showTimer);
  showTimer = null;
  const s = settle;
  pending = null;
  settle = null;
  s?.(agreed);
}

/**
 * The re-agree dialog's mount registers here while the member may be asked.
 * Returns the unregister function; unregistering settles any wait as "no".
 */
export function listenForTermsRequests(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
    if (pending) finish(false);
  };
}

/** Is a request waiting on the member's answer? (The dialog opens while it is.) */
export function termsRequestPending(): boolean {
  return pending !== null;
}

/** The dialog is on screen: stop the show timeout, wait for the member. */
export function noteTermsDialogShown(): void {
  if (showTimer) clearTimeout(showTimer);
  showTimer = null;
}

/** The member agreed (true), or the dialog will not open for this request (false). */
export function settleTermsRequest(agreed: boolean): void {
  if (pending) finish(agreed);
}

/** Ask the member to agree. Resolves true once they have, false if they cannot be asked. */
function requestTermsAcceptance(): Promise<boolean> {
  if (pending) return pending;
  if (!listener) return Promise.resolve(false);
  pending = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const p = pending;
  showTimer = setTimeout(() => finish(false), DIALOG_SHOW_MS);
  listener();
  return p;
}

/** A request whose body can be sent again as is (supabase-js sends JSON strings). */
function canResend(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (typeof Request !== "undefined" && input instanceof Request) return false;
  const body = init?.body;
  return body === undefined || body === null || typeof body === "string";
}

export function termsGateFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const res = await fetchImpl(input, init);
    if (res.status !== 403 || !listener || !canResend(input, init)) return res;
    let text: string;
    try {
      text = await res.clone().text();
    } catch {
      // An unreadable body is not a refusal we can recognise: hand back the original response.
      return res;
    }
    if (!isTermsRefusalBody(text)) return res;
    const agreed = await requestTermsAcceptance();
    if (!agreed) return res;
    return fetchImpl(input, init);
  };
}
