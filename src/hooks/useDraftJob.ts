import { useState, useEffect, useCallback, useRef } from "react";
import { safeStorage } from "@/lib/safeStorage";

const DRAFT_KEY = "helpr_draft_job";
// Debounce window for persisting drafts. Long enough that fast typists
// don't hammer localStorage on every keystroke, short enough that the user
// won't lose meaningful work if the tab dies. A `beforeunload` /
// `visibilitychange:hidden` flush (below) covers the gap when the app is
// refreshed or backgrounded mid-window, which on mobile is the common case.
const SAVE_DEBOUNCE_MS = 5000;

export interface JobDraft {
  title: string;
  description: string;
  category: string;
  location: string;
  dateNeeded: string;
  startTime: string;
  estimatedHours: string;
  budget: string;
  specialRequirements: string;
  isRecurring: boolean;
  recurrenceInterval: string;
  recurrenceEndDate: string;
  jobDuration: string;
  isFlexibleSchedule?: boolean;
  isUrgent?: boolean;
  urgentFee?: string;
  isGroupJob?: boolean;
  helpersNeeded?: string;
  credentialTier?: number;
  pricingMode?: string;
  bidCeiling?: string;
  bidDeadline?: string;
  bidsSealed?: boolean;
  includeMaterials?: boolean;
  materialsNote?: string;
  department?: string;
  requiresW9?: boolean;
  offerToHelperId?: string | null;
  savedAt: number;
}

const emptyDraft: JobDraft = {
  title: "", description: "", category: "other", location: "",
  dateNeeded: "", startTime: "", estimatedHours: "", budget: "",
  specialRequirements: "", isRecurring: false, recurrenceInterval: "weekly",
  recurrenceEndDate: "", jobDuration: "none", savedAt: 0,
};

export function useDraftJob() {
  const [draft, setDraft] = useState<JobDraft>(emptyDraft);
  const [hasDraft, setHasDraft] = useState(false);
  // Latest pending draft + debounce timer. Refs avoid recreating the
  // saveDraft callback on every state change (which would also reset the
  // debounce timer).
  const pendingDraft = useRef<JobDraft>(emptyDraft);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    try {
      const saved = safeStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as JobDraft;
        // Only restore if less than 7 days old
        if (Date.now() - parsed.savedAt < 7 * 24 * 60 * 60 * 1000) {
          setDraft(parsed);
          pendingDraft.current = parsed;
          setHasDraft(true);
        } else {
          safeStorage.removeItem(DRAFT_KEY);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Synchronously persist whatever's currently pending and cancel the
  // debounce. Safe to call when nothing is dirty (write is idempotent).
  const flushDraft = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    // Nothing meaningful typed yet — don't write an empty placeholder draft.
    if (pendingDraft.current.savedAt === 0) return;
    try {
      safeStorage.setItem(DRAFT_KEY, JSON.stringify(pendingDraft.current));
    } catch { /* ignore */ }
  }, []);

  // Flush before unmount AND on the events that fire when a mobile browser
  // tears the page down without an unmount: a hard refresh (`beforeunload`)
  // and app-backgrounding / tab-hide (`visibilitychange` → "hidden", the
  // only reliably-delivered teardown signal on iOS). Without these, the
  // last few seconds of typing inside the debounce window are lost.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushDraft();
    };
    window.addEventListener("beforeunload", flushDraft);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", flushDraft);
      document.removeEventListener("visibilitychange", onHide);
      flushDraft();
    };
  }, [flushDraft]);

  const saveDraft = useCallback((data: Partial<JobDraft>) => {
    // Merge against the latest pending value (not the rendered state) so
    // rapid successive calls within the debounce window don't drop fields.
    const updated = { ...pendingDraft.current, ...data, savedAt: Date.now() };
    pendingDraft.current = updated;
    setDraft(updated);
    setHasDraft(true);

    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      try {
        safeStorage.setItem(DRAFT_KEY, JSON.stringify(pendingDraft.current));
      } catch { /* ignore */ }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const clearDraft = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingDraft.current = emptyDraft;
    setDraft(emptyDraft);
    setHasDraft(false);
    try { safeStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }, []);

  return { draft, hasDraft, saveDraft, flushDraft, clearDraft };
}
