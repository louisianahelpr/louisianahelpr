/**
 * True when a Supabase RPC error means "function not deployed yet" (PostgREST
 * PGRST202): a build that shipped before its migration reached prod. Callers
 * treat it as a quiet fallback, never as an error to report on every visit.
 * One definition for the app (lead review, 2026-10-19).
 */
export function isMissingRpc(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "PGRST202";
}

/**
 * A STRICTER "not deployed yet" for one RPC called by name, for a caller that
 * must not mistake a changed signature for a missing function (useFeature's
 * batched switch read, nightly-red #2601). PostgREST answers a missing
 * function with PGRST202, and when its name is near an existing one it adds a
 * hint pointing at that neighbour ("Perhaps you meant to call the function
 * public.feature_enabled_for(p_key)"), so a hint naming ANOTHER function still
 * means "not deployed" (lead re-review of wip/reds-1019-2, 2026-10-19). A hint
 * naming `rpc` itself means it exists with other parameters: a real failure,
 * the case isMissingRpc above does not tell apart (Q2086 made the Stuck Jobs
 * screen's own copy strict for the same reason).
 */
export function isMissingRpcNamed(error: unknown, rpc: string): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string | null; hint?: string | null };
  if (e.code !== "PGRST202") return false;
  if (!e.hint) return true;
  const names = (text: string | null | undefined) => new RegExp(`\\bpublic\\.${rpc}\\b`).test(text ?? "");
  return names(e.message) && !names(e.hint);
}
