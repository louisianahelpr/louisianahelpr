/**
 * Q2079: true when an RPC error means the function is not deployed yet (edge
 * code can ship before its migration). PostgREST answers PGRST202 when its
 * schema cache has no such function; Postgres' own undefined_function is
 * 42883 (a stale cache, or an argument list that no longer matches). Both
 * mean a retry cannot help until the migration is live, so callers that fall
 * back on "not deployed" read both the same way.
 */
export function rpcNotDeployed(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code;
  return code === "PGRST202" || code === "42883";
}
