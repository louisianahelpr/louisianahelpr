/**
 * Whether Money has a payout to celebrate: the cheap half of
 * PayoutCelebration.tsx, so Money loads the animated card (framer-motion,
 * ~37 KB gz with its proxy chunk) only when there is one. As a static import,
 * Money's payout reads waited for framer-motion on every visit (measured
 * 2026-11-01, cwv-lab admin, 375 Slow 4G + 4x CPU: proxy.js done at 7.1 s,
 * the stripe-payouts read started at 7.2 s).
 */
import { safeStorage } from "@/lib/safeStorage";

/** Subset of payout_transfers we need for the celebration. */
export interface CelebratablePayout {
  id: string;
  amount_cents: number;
  status: string;
  paid_at: string | null;
  created_at: string;
  jobs?: { title?: string } | null;
}

export const LAST_SEEN_PAYOUT_KEY = "helpr_last_seen_payout_at";

/** Returns the epoch ms timestamp the user last "saw" payouts, or 0. */
export function readLastSeen(): number {
  const raw = safeStorage.getItem(LAST_SEEN_PAYOUT_KEY);
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Treat paid_at as authoritative; fall back to created_at if missing. */
export function payoutTimestampMs(p: CelebratablePayout): number {
  const stamp = p.paid_at ?? p.created_at;
  const t = stamp ? new Date(stamp).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Paid payouts newer than the last-seen marker, newest first. */
export function newPaidPayouts(payouts: CelebratablePayout[], lastSeen: number): CelebratablePayout[] {
  return payouts
    .filter((p) => p.status === "paid" && payoutTimestampMs(p) > lastSeen)
    .sort((a, b) => payoutTimestampMs(b) - payoutTimestampMs(a));
}

/** The same test PayoutCelebration opens on: a new paid payout with a positive total. */
export function hasPayoutToCelebrate(payouts: CelebratablePayout[]): boolean {
  const fresh = newPaidPayouts(payouts, readLastSeen());
  return fresh.reduce((sum, p) => sum + (p.amount_cents ?? 0), 0) > 0;
}
