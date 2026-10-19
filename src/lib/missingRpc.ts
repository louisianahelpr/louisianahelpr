/**
 * "Not deployed yet" for ONE RPC called by name: the app's one definition
 * (lead review, 2026-10-19). Every caller passes the name of the RPC it just
 * called, and must not mistake a changed signature for a missing function
 * (src/test/missingRpcIsNamed.test.ts). PostgREST answers a missing
 * function with PGRST202, and when its name is near an existing one it adds a
 * hint pointing at that neighbour ("Perhaps you meant to call the function
 * public.feature_enabled_for(p_key)"), so a hint naming ANOTHER function still
 * means "not deployed" (lead re-review of wip/reds-1019-2, 2026-10-19). A hint
 * naming `rpc` itself means it exists with other parameters: a real failure.
 * The lenient form (any PGRST202) read that case as "not deployed" and fell
 * back quietly (Q2086 made the Stuck Jobs screen's own copy strict for the
 * same reason); it is gone.
 */
export function isMissingRpcNamed(error: unknown, rpc: string): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string | null; hint?: string | null };
  if (e.code !== "PGRST202") return false;
  if (!e.hint) return true;
  const names = (text: string | null | undefined) => new RegExp(`\\bpublic\\.${rpc}\\b`).test(text ?? "");
  return names(e.message) && !names(e.hint);
}
