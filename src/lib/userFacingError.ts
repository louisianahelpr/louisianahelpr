/**
 * Decide what a FAILURE is allowed to say to a person.
 *
 * WHY THIS EXISTS
 * 22 sites across 18 files passed a raw error straight into `toast.error`.
 * Eight had no fallback at all — `toast.error(error.message)` — including the
 * apply flow, the review form and the security tab. The other fourteen wrote
 * `toast.error(err.message || "Couldn't save that — try again")`, which reads
 * like a safety net and is the opposite: `||` only reaches the human copy when
 * the raw message is EMPTY, so the raw one wins in every real failure and the
 * good sentence sitting right there never renders.
 *
 * What a person then saw, on a core-loop surface:
 *
 *     new row violates row-level security policy for table "reviews"
 *     duplicate key value violates unique constraint "reviews_job_id_key"
 *
 * That is schema internals, it reads as a crash, and it tells them nothing
 * they can act on.
 *
 * WHY NOT JUST ALWAYS USE THE FALLBACK
 * Because some raw messages are OURS and are good. The edge functions return
 * deliberate copy — "Too many requests — try again in a minute.", "This task
 * isn't accepting applications anymore." — and replacing those with a generic
 * fallback would be a downgrade. So this does not choose by source (which the
 * client cannot know) but by SHAPE: a message that looks like a database or
 * transport internal is suppressed, anything else is trusted.
 *
 * The raw text is never lost — it goes to the console, where a developer
 * looking at a bug report can still see it.
 */

/**
 * Fingerprints of machine-generated errors. Each is a real Postgres, PostgREST,
 * Supabase-auth or fetch string, not a guess at one.
 */
const INTERNAL_PATTERNS: RegExp[] = [
  /violates row-level security/i,
  /duplicate key value/i,
  /violates (foreign key|unique|check|not-null) constraint/i,
  /constraint "[^"]+"/i,
  /relation "[^"]+" does not exist/i,
  /column "[^"]+"/i,
  /function [\w.]+\(.*\) does not exist/i,
  /permission denied for (table|schema|function|relation)/i,
  /^PGRST\d+/i,
  /Could not find the '[^']+' column/i,
  /JWT|jwt expired|invalid claim/i,
  /^\s*\{.*\}\s*$/, // a serialised object, not a sentence
  /^(TypeError|ReferenceError|SyntaxError|RangeError):/,
  /Failed to fetch|NetworkError|ERR_[A-Z_]+/,
  /supabase|postgres|pgrst/i,
  /\bat \w+ \(.*:\d+:\d+\)/, // a stack frame
  // supabase-js's own transport wrappers. They read as prose and contain none
  // of the words above, so they sail through: a user who tipped, boosted a
  // job, or opened a dispute was told "Edge Function returned a non-2xx status
  // code" — an implementation detail with no next step. Observed live on
  // /signup 2026-09-02, and reachable from TipDialog, JobBoostDialog,
  // ReferralSection, AdminDisputes and SecurityTab, because this is what
  // supabase-js throws for a non-2xx from ANY of the 71 functions.invoke calls.
  //
  // There are THREE of these, not one, and the first pass only caught the
  // third. `FunctionsClient.invoke` (functions-js 2.112.3) can throw exactly:
  //   FunctionsFetchError  "Failed to send a request to the Edge Function"
  //                        — the fetch itself rejected: offline, DNS, TLS,
  //                          abort. The likeliest of the three on a phone.
  //   FunctionsRelayError  "Relay Error invoking the Edge Function"
  //                        — the response carried `x-relay-error: true`.
  //   FunctionsHttpError   "Edge Function returned a non-2xx status code"
  // Matching the shared "Edge Function" phrase rather than three literals
  // means a library rewording cannot silently re-open the hole. Verified
  // safe: no user-facing copy in any of the 68 functions under
  // supabase/functions/ contains that phrase (the only two non-comment hits
  // are stripe-webhook's Slack ops alerts, which never reach a browser).
  //
  // The deliberate edge-function copy this filter exists to PRESERVE
  // ("This task isn't accepting applications anymore.") is read out of the
  // response body by the callers, not carried on these wrappers — so
  // suppressing them costs none of it. See completeSignupError.ts for the
  // signup path, which reads that body instead of settling for a fallback.
  /\bEdge Function\b/i,
  // A bare HTTP reason phrase is a status line, not a sentence. auth-js falls
  // back to `error.statusText || \`HTTP ${error.status}\`` whenever a non-2xx
  // from GoTrue is not JSON — which is what a CDN, a gateway or a WAF in front
  // of Supabase returns — so "Service Unavailable" and "HTTP 502" were being
  // shown to a person mid-signup as if they were advice.
  /^HTTP \d{3}$/i,
  /^(Bad Request|Unauthorized|Forbidden|Not Found|Request Timeout|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)$/i,
];

/** A sentence a person can read: starts like prose and is not enormous. */
const MAX_SHOWABLE = 160;

/**
 * The message to show a person for `err`, falling back to `fallback` whenever
 * the raw text looks machine-generated, is absent, or is too long to be copy.
 *
 * Always logs the raw error, so nothing is lost for debugging.
 *
 * @example
 *   toast.error(userFacingError(err, "Couldn't send your tip — try again?"));
 */
export function userFacingError(err: unknown, fallback: string): string {
  // Log first and unconditionally — this runs even when we show the fallback,
  // which is the case where the raw text would otherwise vanish entirely.
  if (err !== undefined && err !== null) {
     
    console.error("[userFacingError]", err);
  }

  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : "";

  const msg = raw.trim();
  if (!msg) return fallback;
  if (msg.length > MAX_SHOWABLE) return fallback;
  if (INTERNAL_PATTERNS.some((re) => re.test(msg))) return fallback;

  return msg;
}
