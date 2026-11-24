import { useEffect, useRef } from "react";

/**
 * Back (and iOS swipe-back) closes an open sheet instead of leaving the page (flow audit 11-23, B4: Back with the
 * guides' "Save for someone" or "My Wish List" sheet open left the 26,000 px guide for the index).
 *
 * While any sheet using this hook is open there is ONE extra history entry on top, a copy of the current one (same
 * URL, same router state, plus a marker), so React Router sees no navigation. Back pops that entry and every open
 * sheet closes. Closing a sheet any other way (Done, X, tap outside) takes the entry back off, a tick later so a sheet
 * that opens right after another (Save for someone -> View list) keeps it. A link that navigates away from inside a
 * sheet leaves the copy behind, which is harmless: it is the same page.
 */
const MARK = "lhSheet";
const closers = new Map<symbol, () => void>();
let pushed = false;
let ignorePops = 0;
let listening = false;

const onPop = () => {
  if (ignorePops > 0) {
    ignorePops -= 1;
    return;
  }
  if (!pushed) return;
  pushed = false;
  const all = [...closers.values()];
  closers.clear();
  for (const close of all) close();
};

const onTop = () => {
  const s = window.history.state as Record<string, unknown> | null;
  return !!s && s[MARK] === true;
};

export function useCloseOnBack(open: boolean, close: () => void): void {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    if (!listening) {
      window.addEventListener("popstate", onPop);
      listening = true;
    }
    const id = Symbol("sheet");
    closers.set(id, () => ref.current());
    if (!pushed) {
      const prev = (window.history.state as Record<string, unknown> | null) ?? {};
      window.history.pushState({ ...prev, [MARK]: true }, "");
      pushed = true;
    }
    return () => {
      // Already closed by Back: its entry is gone.
      if (!closers.delete(id)) return;
      window.setTimeout(() => {
        if (closers.size > 0 || !pushed) return;
        pushed = false;
        if (onTop()) {
          ignorePops += 1;
          window.history.back();
        }
      }, 0);
    };
  }, [open]);
}
