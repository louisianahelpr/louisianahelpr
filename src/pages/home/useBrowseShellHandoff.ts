import { useEffect, useLayoutEffect } from "react";

/**
 * PERF-SHELL (Q652): the job cards api/share.ts drew into /browse's HTML cover the page until `settled` (the session
 * check is done and the feed's list, empty, error or offline state is on screen), then go in the same frame
 * (src/boot/browseShellHandoff.ts moved them out of #boot-loader). Also on unmount. The id is a literal because a page
 * must not import src/boot (see src/boot/guestJobsPrefetch.ts); src/test/browseShellHandoff.test.ts pins it.
 */
export function useBrowseShellHandoff(settled: boolean): void {
  useLayoutEffect(() => {
    if (settled) document.getElementById("lh-browse-shell")?.remove();
  }, [settled]);
  useEffect(() => () => document.getElementById("lh-browse-shell")?.remove(), []);
}
