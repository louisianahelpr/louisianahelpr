import { useState, useEffect, useCallback } from "react";

const DRAFT_KEY = "helpr_draft_job";

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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as JobDraft;
        // Only restore if less than 7 days old
        if (Date.now() - parsed.savedAt < 7 * 24 * 60 * 60 * 1000) {
          setDraft(parsed);
          setHasDraft(true);
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      }
    } catch { /* ignore */ }
  }, []);

  const saveDraft = useCallback((data: Partial<JobDraft>) => {
    const updated = { ...draft, ...data, savedAt: Date.now() };
    setDraft(updated);
    setHasDraft(true);
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
  }, [draft]);

  const clearDraft = useCallback(() => {
    setDraft(emptyDraft);
    setHasDraft(false);
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }, []);

  return { draft, hasDraft, saveDraft, clearDraft };
}
