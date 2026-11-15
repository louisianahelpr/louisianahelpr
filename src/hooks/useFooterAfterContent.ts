import { useContext, useEffect, useState, type RefObject } from "react";
import { QueryClientContext } from "@tanstack/react-query";

/** How long the page's reads must stay idle before a page that never fills the window shows its footer. */
export const FOOTER_IDLE_MS = 700;
/** The longest the footer waits: a read that keeps failing and retrying (react-query backs off ~7 s) or never settles
 *  must not leave a page with no footer. Kept past the slowest content measured at 375 under Slow 4G + 4x CPU (the item
 *  page's content landed at 8.9-9.2 s, cwv-lab 11-15), or the cap itself would paint the footer high again. */
export const FOOTER_MAX_WAIT_MS = 12_000;

/**
 * Q2784 follow-up (www, 11-15): the guest public frame (GuestPublicFrame) painted PublicLayout's footer under the
 * page's loading state; at 1280 the loading /declutter page is shorter than the window, so the footer painted high in
 * view and then jumped down when the grid arrived (CLS 0.29 of 0.307 in one shift, 2 of 3 loads).
 *
 * Same rule as Q1312 (/browse, PublicLayout's `footer` prop): the footer waits for the content instead of a
 * screen-tall reserve (the reserve is the blank band the owner refused). It shows, once and for good, when
 *   - the content already reaches the bottom of the window, so the footer first paints out of view and any later
 *     growth only moves an off-screen footer; or
 *   - the page's reads (react-query) have been idle for FOOTER_IDLE_MS, for a page whose content never fills the
 *     window (a short page, an empty list, an error); or
 *   - FOOTER_MAX_WAIT_MS has passed (measured 11-15: in the lab, where RPC reads are blocked and retry, /search
 *     showed no footer at all until the retries ended).
 * A footer that first appears under settled content is a new node, not a shift.
 * Guard: src/test/guestFrameFooterWaitsForContent.test.tsx.
 */
export function useFooterAfterContent(contentRef: RefObject<HTMLElement | null>): boolean {
  const client = useContext(QueryClientContext);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    const el = contentRef.current;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const fills = () => {
      const now = contentRef.current;
      return !!now && now.getBoundingClientRect().bottom >= window.innerHeight;
    };
    const settle = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = undefined;
      if (fills()) return setReady(true);
      if ((client?.isFetching() ?? 0) === 0) idleTimer = setTimeout(() => setReady(true), FOOTER_IDLE_MS);
    };
    const resize = typeof ResizeObserver === "undefined" || !el ? null : new ResizeObserver(settle);
    if (resize && el) resize.observe(el);
    const unsubscribe = client?.getQueryCache().subscribe(settle);
    const capTimer = setTimeout(() => setReady(true), FOOTER_MAX_WAIT_MS);
    settle();
    return () => {
      clearTimeout(capTimer);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      resize?.disconnect();
      unsubscribe?.();
    };
  }, [client, contentRef, ready]);
  return ready;
}
