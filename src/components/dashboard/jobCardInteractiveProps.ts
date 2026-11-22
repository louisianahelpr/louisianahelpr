import type { KeyboardEvent, MouseEvent } from "react";
import { hapticLight } from "@/lib/haptics";
import type { JobCardProps } from "./jobCardProps";

/* Moved out of JobCard.tsx unchanged (Q806): the card root's tap / keyboard / label props. */
  // Audit 11-21 (P29): the guest card on /browse was a bare div with an onClick (a stale note said a wrapper button
  // supplied the rest; that page was deleted 2026-09-07): not focusable, not Enter/Space-activatable, and, since it
  // never held focus, closing the job sheet it opened left focus on <body>. Both branches are a focusable button now;
  // the guest tap also focuses the card itself (WebKit does not focus a clicked element), so the dialog's own
  // return-focus (useDialogFocus) brings focus back to it when the sheet closes.
export function jobCardInteractiveProps({
  isGuest,
  job,
  onSelect,
  handleTap,
  prefetchHandlers,
}: {
  isGuest: boolean;
  job: JobCardProps["job"];
  onSelect: JobCardProps["onSelect"];
  handleTap: () => void;
  prefetchHandlers: ReturnType<typeof import("@/lib/usePrefetchOnTouch").usePrefetchOnTouch>;
}) {
  return {
    // Guest: the whole card taps through to onSelect (openDetailJob, the job sheet).
    onClick: isGuest
      ? (e: MouseEvent<HTMLElement>) => { e.currentTarget.focus({ preventScroll: true }); hapticLight(); onSelect(job); }
      : handleTap,
    role: "button" as const,
    tabIndex: 0,
    // No aria-label (WCAG 2.5.3 Label in Name, axe label-content-name-mismatch on /explore, 11-06):
    // "View <title> — $<price>" left out the card's other words (category, place, date), so a voice
    // user who said what they saw hit nothing. The card's own words are its name now, after an
    // sr-only "View " (JobCard.tsx). Guard: src/test/labelContainsVisibleText.test.ts.
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        hapticLight();
        onSelect(job);
      }
    },
    ...prefetchHandlers,
  };
}
