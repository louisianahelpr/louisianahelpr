/**
 * The text of a caught value, for a response body or a log line — never its
 * stack.
 *
 * An Error gives its `message`; a thrown string is itself; a thrown object
 * gives its string `message` if it has one (supabase-js errors are plain
 * objects); anything else gives `fallback`. It replaces
 * `err instanceof Error ? err.message : String(err)`: `String(err)` hands the
 * caught value itself to the response, which CodeQL js/stack-trace-exposure
 * reads as a possible stack trace (alerts 73, 85, 88). The output for an Error
 * or a string is unchanged.
 */
export function caughtMessage(err: unknown, fallback = "unknown error"): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return `${err}`;
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message : fallback;
}
