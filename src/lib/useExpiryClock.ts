import { useEffect, useState } from "react";

/**
 * How long until `formatTimeLeft(expiry)` (or the `expires_at <= now` bucket
 * rule) would give a different answer. Null when it never will again.
 *
 * The label floors to whole minutes, so it changes on each minute boundary
 * of the remainder; in the final minute it changes exactly once, at expiry.
 */
export function msUntilExpiryLabelChanges(expiresAt: string | null | undefined, now: number): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  const left = t - now;
  if (left <= 0) return null;
  if (left <= 60_000) return left;
  return left % 60_000 || 60_000;
}

/**
 * The current time, re-read exactly when any of these expiries would change
 * its countdown text or its Activity bucket — so "Under a minute left" flips
 * to "Expired", and the listing leaves Waiting, at the instant it expires
 * rather than on the next unrelated re-render. No timer when nothing is live.
 */
export function useExpiryClock(expiries: ReadonlyArray<string | null | undefined>): Date {
  const [now, setNow] = useState(() => new Date());
  const key = expiries.map((e) => e ?? "").join("|");
  useEffect(() => {
    const at = Date.now();
    let next: number | null = null;
    for (const e of key ? key.split("|") : []) {
      const ms = msUntilExpiryLabelChanges(e || null, at);
      if (ms !== null && (next === null || ms < next)) next = ms;
    }
    if (next === null) return;
    // +25ms so the re-read lands on the far side of the boundary.
    const id = setTimeout(() => setNow(new Date()), Math.min(next + 25, 2_147_483_647));
    return () => clearTimeout(id);
  }, [key, now]);
  return now;
}
