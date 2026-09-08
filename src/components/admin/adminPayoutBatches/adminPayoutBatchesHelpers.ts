import { safeStorage } from "@/lib/safeStorage";
import { toneBadgeClasses } from "@/components/admin/tones";

export const LEDGER_TONE: Record<string, string> = {
  paid: toneBadgeClasses.success,
  pending: toneBadgeClasses.warning,
  failed: "bg-destructive/10 text-destructive",
  reversed: toneBadgeClasses.neutral,
};

// Hold-for-review queue is stored in localStorage.
//
// The previous comment here claimed a stable key means "every admin sees the
// same list". That is the opposite of what localStorage does: it is per
// browser, per device, per profile, and never syncs. `get_payout_batches()`
// has no hold column and returns every eligible batch to every admin, so a
// hold placed by one admin is INVISIBLE to a second admin on another machine,
// who can pay the batch out from the row's own button. On a money queue, a
// safety flag only one person can see is a real hazard — the UI labels this
// "on this device" so nobody relies on it as a team-wide block. Making it a
// genuine cross-admin hold needs a server-side column; until then, treat it as
// a personal triage marker.
const HOLD_KEY = "helpr.admin_payout_holds.v1";
export const loadHolds = (): Record<string, { reason: string; addedAt: string; addedBy?: string }> => {
  try {
    const raw = safeStorage.getItem(HOLD_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    // Silent by design: holds are a PERSONAL triage marker in this admin's own
    // browser (see the comment above — a real cross-admin hold needs a server
    // column). An unreadable record means "no holds", which shows every batch
    // rather than hiding one, so the failure cannot conceal work.
    return {};
  }
};
export const saveHolds = (h: Record<string, { reason: string; addedAt: string; addedBy?: string }>) => {
  try {
    safeStorage.setItem(HOLD_KEY, JSON.stringify(h));
  } catch {
    // Silent by design: same personal-marker reasoning as loadHolds. A lost
    // write means a hold is not remembered, which surfaces the batch again —
    // the safe direction for money.
  }
};
