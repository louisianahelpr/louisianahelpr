/**
 * The hand-off of a gift guide page's server-drawn first screen (src/lib/guideShell.mjs) into the app.
 *
 * api/share.ts puts #lh-guide-shell first inside #boot-loader, so a guest sees the guide's banner and first gifts at
 * HTML parse instead of after the whole app (~4.5 s on Slow 4G + 4x CPU). React's first commit removes #boot-loader,
 * and the page's first frames are a Suspense fallback and then a list still loading, so before createRoot main.tsx
 * calls adoptGuideShell(), which moves the block to <body> where React never touches it. It goes in the frame after
 * the page's own content is on screen (the same marks scripts/perf/cwv-lab.mjs reads as real content), keeping the
 * reader's scroll position. Removing a fixed layer is not a layout shift.
 *
 * Kept only for a signed-out visit to the very page it was drawn for (a signed-in desktop has the rail and its own
 * header, so the guest drawing would jump), and never longer than GUIDE_SHELL_MAX_MS.
 *
 * Guard: src/test/guideShells.test.ts.
 */
export const GUIDE_SHELL_ELEMENT_ID = "lh-guide-shell";
/** Upper bound on how long the block may cover the booting app. */
export const GUIDE_SHELL_MAX_MS = 10_000;
/** The page's own content (scripts/perf/cwv-lab.mjs READY marks for the guide pages). */
export const GUIDE_READY_SELECTOR = "[data-gift-pick],[data-gift-code],[data-gift-sale],[data-gift-sbs-row],[data-gift-deal],.gg-cover,[data-gift-sb-grid]";

export function adoptGuideShell(pathname: string, signedIn: boolean, doc: Document = document): void {
  const el = doc.getElementById(GUIDE_SHELL_ELEMENT_ID);
  if (!el) return;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (signedIn || el.getAttribute("data-guide-shell") !== path) {
    el.remove();
    return;
  }
  doc.body.appendChild(el);
  const root = doc.getElementById("root");
  const view = doc.defaultView;
  let observer: MutationObserver | null = null;
  const finish = () => {
    observer?.disconnect();
    clearTimeout(timer);
    if (!el.isConnected) return;
    const y = el.scrollTop;
    el.remove();
    if (y > 0) view?.scrollTo(0, y);
  };
  const timer = setTimeout(finish, GUIDE_SHELL_MAX_MS);
  if (!root || !view || typeof view.MutationObserver !== "function") return;
  // Two frames after the content lands: the phone's count row (useIsMobile's effect) commits right after the list.
  const ready = () => {
    if (!root.querySelector(GUIDE_READY_SELECTOR)) return;
    observer?.disconnect();
    view.requestAnimationFrame(() => view.requestAnimationFrame(finish));
  };
  observer = new view.MutationObserver(ready);
  observer.observe(root, { childList: true, subtree: true });
}
