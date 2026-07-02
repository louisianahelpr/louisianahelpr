import { safeStorage } from "@/lib/safeStorage";

export const LEDGER_TONE: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  failed: "bg-destructive/10 text-destructive",
  reversed: "bg-muted text-muted-foreground",
};

// Hold-for-review queue is stored client-side under a stable key so
// every admin sees the same list. Persisting it server-side would
// need a migration; for now the localStorage approach is enough since
// it's a small triage queue that admins clear as they go.
export const HOLD_KEY = "helpr.admin_payout_holds.v1";
export const loadHolds = (): Record<string, { reason: string; addedAt: string; addedBy?: string }> => {
  try {
    const raw = safeStorage.getItem(HOLD_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};
export const saveHolds = (h: Record<string, { reason: string; addedAt: string; addedBy?: string }>) => {
  try { safeStorage.setItem(HOLD_KEY, JSON.stringify(h)); } catch { /* noop */ }
};
