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
