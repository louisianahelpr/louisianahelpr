import { useCallback, useEffect, useState } from "react";
import { safeStorage, ensureHydrated } from "@/lib/safeStorage";
import { fetchTourCompletion, markTourCompleted } from "@/lib/onboardingTourCompletion";

/**
 * WHETHER THIS ACCOUNT STILL GETS THE FIRST RUN (board 53 + the short coach-mark
 * tour that replaced the old 7-step OnboardingTour, owner 2026-10-20).
 *
 * The "seen" state is stored exactly where the old tour stored it, so no member
 * who finished or skipped that tour sees this one, and every e2e suppression
 * keeps working:
 *  - the ACCOUNT column profiles.onboarding_tour_completed_at (the truth;
 *    survives reinstalls), read by fetchTourCompletion, stamped by
 *    markTourCompleted;
 *  - the device hint `helpr_onboarding_<userId>` ({ completed: true }), read
 *    after ensureHydrated so a just-finished run never flashes back.
 * Unknown (offline, RLS) is never "not seen": it stays quiet this session.
 */
const LEGACY_KEY = "helpr_onboarding";
export const firstRunStorageKey = (userId: string) => `${LEGACY_KEY}_${userId}`;

function deviceSaysDone(userId: string): boolean {
  try {
    let raw = safeStorage.getItem(firstRunStorageKey(userId));
    if (!raw) {
      // One-time claim of the old un-namespaced key (the old tour's migration).
      const legacy = safeStorage.getItem(LEGACY_KEY);
      if (legacy) {
        safeStorage.setItem(firstRunStorageKey(userId), legacy);
        safeStorage.removeItem(LEGACY_KEY);
        raw = legacy;
      }
    }
    return !!raw && !!JSON.parse(raw)?.completed;
  } catch {
    return false; // a malformed or blocked value reads as "not on this device"
  }
}

function rememberDone(userId: string) {
  try {
    safeStorage.setItem(firstRunStorageKey(userId), JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
  } catch {
    /* best-effort: the account stamp below is the truth */
  }
}

/** `open`: show the first run now. `pending`: it may still open (anything queued behind it waits). */
export function useFirstRunGate(userId: string | undefined, onHome: boolean) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    if (!onHome || !userId) {
      setPending(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => { timer = setTimeout(() => !cancelled && setOpen(true), 600); };
    ensureHydrated()
      .then(async () => {
        if (cancelled) return;
        const local = deviceSaysDone(userId);
        const account = await fetchTourCompletion(userId);
        if (cancelled) return;
        if (account.status === "completed") { if (!local) rememberDone(userId); setPending(false); return; }
        if (account.status === "error") { setPending(false); return; }
        if (local) {
          // This device finished it before the account recorded it: heal the account.
          if (account.status === "not_completed") void markTourCompleted(userId);
          setPending(false);
          return;
        }
        show();
      })
      .catch(() => { if (!cancelled) setPending(false); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [userId, onHome]);

  /** Finished or skipped: done for good, on the device and on the account. */
  const finish = useCallback(() => {
    if (userId) {
      rememberDone(userId);
      void markTourCompleted(userId);
    }
    setOpen(false);
    setPending(false);
  }, [userId]);

  /** "Take the tour again" (Help): reopen, ignoring the stored state. */
  const replay = useCallback(() => { setPending(true); setOpen(true); }, []);

  return { open, pending, finish, replay };
}
