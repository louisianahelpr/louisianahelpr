/**
 * A relation or column the database does not have yet (the web deploy ran
 * ahead of db-deploy). The panel renders nothing rather than an error.
 *
 * Tables and columns only (Q2190): an RPC caller asks isMissingRpcNamed
 * (src/lib/missingRpc.ts) about the function it called, because PGRST202 also
 * answers a function that exists with other arguments, a real failure.
 *
 * Its own module (B87, 11-01) so Home's schedule reads (scheduleChange.ts, scheduleClashes.ts) do not import
 * seriesDates.ts and, through it, the age gate, the award gate and lifecycleErrors' chunk. seriesDates re-exports it.
 */
export function isNotDeployedYet(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(code);
}
