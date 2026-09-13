/**
 * The ONE on-disk session cache check for every prod harness: journeys
 * (e2e/journeys/fixtures.ts getSession), which prod-audit and a11y-prod reuse,
 * and scripts/audit/pressProdSafety.mjs. Plain erasable TypeScript importing
 * only node builtins, so Node runs it directly from a .mjs script.
 *
 * Why the clock is not enough: a revoked GoTrue session (global Log Out, a
 * re-mint elsewhere) keeps an unexpired JWT that PostgREST still accepts, and
 * the app signs the tab out at its first getUser(). Measured 2026-09-13: a
 * deep link bounced to /login on a 40-minute-fresh cache, so signed-in specs
 * were silently testing the logged-out screen.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type CachedSession = { access_token: string; expires_at?: number; user?: { id: string } };

/** A cached session GoTrue still accepts, or null (the caller mints). A dead or corrupt file is deleted. */
export async function readLiveCache<S extends CachedSession>(
  file: string,
  opts: { minFreshMs: number; isAlive: (s: S) => Promise<boolean> },
): Promise<S | null> {
  if (!existsSync(file)) return null;
  let disk: S | null;
  try {
    disk = JSON.parse(readFileSync(file, "utf8")) as S;
  } catch {
    // Corrupt JSON is a cache miss by design: the caller mints a fresh session.
    disk = null;
  }
  if (!disk) {
    rmSync(file, { force: true });
    return null;
  }
  if (!disk.access_token || (disk.expires_at ?? 0) * 1000 <= Date.now() + opts.minFreshMs) return null;
  const alive = await opts.isAlive(disk).catch((e: unknown) => {
    // Visible, then treated as dead: re-minting is safe, reusing an unverified session is not.
    console.warn(`[liveSession] liveness check failed for ${file}: ${String(e)}`);
    return false;
  });
  if (!alive) {
    rmSync(file, { force: true });
    return null;
  }
  return disk;
}

/** GoTrue's own answer (GET /auth/v1/user). A network failure counts as dead, with a warning. */
export async function sessionAlive(supabaseUrl: string, anon: string, accessToken: string): Promise<boolean> {
  const r = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${accessToken}` },
  }).catch((e: unknown) => {
    console.warn(`[liveSession] /auth/v1/user unreachable: ${String(e)}`);
    return null;
  });
  return Boolean(r?.ok);
}

export function writeCache(file: string, session: CachedSession): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(session), { mode: 0o600 });
}
