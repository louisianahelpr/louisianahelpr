/**
 * unwrap — surface Supabase failures instead of swallowing them.
 *
 * The codebase-wide pattern `const { data } = await supabase…` drops the
 * `error` half of the result, so a failed fetch silently degrades to an
 * empty / blank screen. Passing the result through `unwrap()` makes the
 * failure surface: inside a React Query `queryFn` it flips the query to
 * its error state (which drives `<ErrorState />`); in a manual async
 * function it throws into the caller's `try/catch`.
 *
 *   const rows = unwrap(await supabase.from("jobs").select("*"));
 *   const fee  = unwrap(await supabase.rpc("get_public_platform_settings"));
 *
 * Works for table queries, RPC calls, and edge-function invocations —
 * anything shaped `{ data, error }`.
 */
export function unwrap<T>(result: { data: T; error: { message: string } | null }): T {
  const { data, error } = result;
  if (error) {
    // Re-throw a real Error so downstream `instanceof Error` checks
    // (errorLogger, toast copy) work, while preserving any extra fields
    // the Supabase error carried (code / details / hint).
    throw error instanceof Error
      ? error
      : Object.assign(new Error(error.message), error);
  }
  return data;
}

/**
 * functionErrorMessage — recover the real, user-facing reason from a failed
 * `supabase.functions.invoke`.
 *
 * On any non-2xx the SDK returns a `FunctionsHttpError` whose `.message` is the
 * generic "Edge Function returned a non-2xx status code". The actual reason our
 * edge functions send lives in the JSON body (`{ error: "…" }`), reachable via
 * `error.context` (the raw `Response`). This reads that body and returns the
 * human message, falling back to `fallback` so the caller never shows the raw
 * SDK string to a user.
 */
export async function functionErrorMessage(
  error: unknown,
  fallback = "Couldn't complete that action — please try again.",
): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      if (body && typeof body.error === "string" && body.error.trim()) {
        return body.error;
      }
    } catch {
      // Body wasn't JSON or was already consumed — fall through to fallback.
    }
  }
  return fallback;
}

/**
 * functionErrorBody — the whole JSON body of a failed `functions.invoke`.
 *
 * `functionErrorMessage` returns only the human string, which is right for a
 * toast but loses the machine-readable flags our edge functions send alongside
 * it (e.g. `needsOnboardingFee`, `attemptLimitReached`). Those flags are what
 * let a refusal offer the ONE tap that resolves it instead of dead-ending, so
 * the caller needs the object, not the sentence.
 *
 * Returns `null` when the body isn't JSON or was already consumed.
 */
export async function functionErrorBody(
  error: unknown,
): Promise<Record<string, unknown> | null> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      if (body && typeof body === "object") return body as Record<string, unknown>;
    } catch {
      // Not JSON — nothing to recover.
    }
  }
  return null;
}
