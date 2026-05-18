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
