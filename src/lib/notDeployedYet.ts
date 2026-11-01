/**
 * A relation, column or RPC the database does not have yet (the web deploy ran
 * ahead of db-deploy). The panel renders nothing rather than an error.
 *
 * Its own module (B87, 11-01) so Home's schedule reads (scheduleChange.ts, scheduleClashes.ts) do not import
 * seriesDates.ts and, through it, the age gate, the award gate and lifecycleErrors' chunk. seriesDates re-exports it.
 */
export function isNotDeployedYet(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  return ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(code);
}
