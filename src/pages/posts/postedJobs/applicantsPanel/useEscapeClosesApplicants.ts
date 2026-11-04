import { useEffect } from "react";
import { type Job } from "@/components/job-card/activityConstants";

// Moved out of ApplicantsPanel.tsx unchanged (Q806 god-component ratchet, pure move).

/**
 * Escape closes the panel, the same as the back chevron.
 *
 * A full-screen overlay dismissible only by hitting one specific control is
 * a keyboard dead end, and every other dismissible surface in the app (every
 * Dialog, every Sheet) takes Escape — so this one reads as broken without it.
 *
 * A window listener rather than `onKeyDown` on the container: this panel is
 * a push, not a modal, so it never takes focus on open and a container
 * handler would simply never fire. The guard is the price of that — an open
 * Radix overlay (the Boost and Edit dialogs the empty state opens, the
 * decline sheet) owns Escape while it is up, and closing the panel out from
 * under it would dismiss two things with one key.
 */
export function useEscapeClosesApplicants(setSelectedJob: (job: Job | null) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"]')) return;
      setSelectedJob(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelectedJob]);
}
