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
