import type { KeyboardEvent } from "react";
import { hapticLight } from "@/lib/haptics";
import type { JobCardProps } from "./jobCardProps";

/* Moved out of JobCard.tsx unchanged (Q806): the card root's tap / keyboard / label props. */
  // THIS RATIONALE IS DEAD AND THE GUEST BRANCH IS NOW AN A11Y BUG.
  // It said the guest card "is wrapped in an outer interactive element by the
  // caller (a <button> in Jobs.tsx that opens the preview)", so the root must
  // not nest a second one. src/pages/Jobs.tsx does not exist — that page was
  // deleted 2026-09-07 — and the ONLY variant="guest" call site left is
  // DashboardGuest.tsx, which maps these cards into a plain <div> with no
  // wrapper at all. So on /browse (the only signed-out feed) every card is a
  // bare div with an onClick: not focusable, not Enter/Space-activatable, and
  // unnamed to a screen reader, while the authed branch below supplies all
  // four. Restoring role/tabIndex/onKeyDown/aria-label is the fix; it is a
  // behaviour change and deliberately NOT made in this comment-only pass.
export function jobCardInteractiveProps({
  isGuest,
  job,
  onSelect,
  handleTap,
  priceAria,
  prefetchHandlers,
}: {
  isGuest: boolean;
  job: JobCardProps["job"];
  onSelect: JobCardProps["onSelect"];
  handleTap: () => void;
  priceAria: string;
  prefetchHandlers: ReturnType<typeof import("@/lib/usePrefetchOnTouch").usePrefetchOnTouch>;
}) {
  return isGuest
    ? {
        // Guest: the whole card taps through to onSelect, which on the guest
        // dashboard is openDetailJob and routes to signup from there. Plain
        // onClick only — see the note above for why that is now wrong.
        onClick: () => { hapticLight(); onSelect(job); },
        ...prefetchHandlers,
      }
    : {
        onClick: handleTap,
        role: "button" as const,
        tabIndex: 0,
        "aria-label": `View ${job.title} — ${priceAria}`,
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
