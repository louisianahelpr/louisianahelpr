import { useEffect, type RefObject } from "react";
import { isNativePlatform } from "@/lib/nativeInit";
import type { TabKey } from "./legalSections";

/* Moved out of Legal.tsx unchanged (Q806). Legal.tsx clears the search on a
   tab switch in its own effect; this one keeps the sticky band put. */
export function useTabSwitchKeepsBandPut(
  tab: TabKey,
  stickyRowRef: RefObject<HTMLDivElement>,
  scrollRef: RefObject<HTMLDivElement>,
): void {
  // Switching tabs is a fresh document: Legal.tsx drops any active search, and
  // this starts the new policy at its beginning rather than wherever the old one happened to
  // be scrolled to. The goal is unchanged — deep-scrolling Privacy then
  // tapping Terms must not land you mid-page — but the means are.
  //
  // This used to `scrollTo({ top: 0 })`, which was the single biggest source
  // of the "whole page jumps when you toggle terms" complaint: reading at
  // y=157 and tapping a tab yanked the viewport to the very top, so the
  // header, the title row and the tab band all visibly flew back down the
  // screen under your finger.
  //
  // Instead we scroll to the sticky band's OWN offset. Once you are past that
  // offset the band is pinned at the top of the viewport, and landing exactly
  // on the offset puts it in that same pinned position — so the row you just
  // tapped does not move a single pixel, while the policy underneath it is
  // correctly reset to its first line. If you are at or above the offset the
  // band is not pinned yet and the document top is already in view, so we do
  // not scroll at all.
  //
  // Measuring the band's UNPINNED offset is the fiddly part. Both of the
  // obvious reads are contaminated once the band is actually stuck:
  // `getBoundingClientRect().top` is 0 (that's what "pinned" means), and —
  // measured, not assumed — Chrome folds the sticky displacement into
  // `offsetTop` as well, so a pinned band reports its own scroll position and
  // `current > bandOffset` can never be true. So we flip the element to
  // `position: static` for the duration of one synchronous read and put it
  // straight back. No paint happens between the two writes, so nothing
  // flickers, and the rect we read in between is the honest layout position.
  useEffect(() => {
    const row = stickyRowRef.current;
    if (!row) return;
    const container = isNativePlatform ? scrollRef.current : null;

    const prevPosition = row.style.position;
    row.style.position = "static";
    const naturalTop = row.getBoundingClientRect().top;
    row.style.position = prevPosition;

    // Viewport-relative → container-relative. For the web branch the scroll
    // box is the document, so the container terms fall away to `scrollY`.
    const containerTop = container ? container.getBoundingClientRect().top : 0;
    const current = container ? container.scrollTop : window.scrollY;
    // Pinned means `stickyTop` below the scroll box's top (the marketing
    // Navbar's height for a guest on the web), so the band is pinned exactly
    // when the box has scrolled to bandOffset - stickyTop.
    const stickyTop = Number.parseFloat(getComputedStyle(row).top) || 0;
    const pinAt = Math.max(0, naturalTop - containerTop + current - stickyTop);

    if (current > pinAt) {
      if (container) {
        container.scrollTo({ top: pinAt });
      } else {
        window.scrollTo({ top: pinAt });
      }
    }
  }, [tab]);
}
