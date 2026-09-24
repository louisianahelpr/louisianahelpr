import { useEffect, useState } from "react";
import { report } from "@/lib/errorLogger";

/**
 * framer-motion, fetched only when the bell's panel is OPEN.
 *
 * WHY THIS EXISTS. `NotificationPanel` is mounted by every title bar
 * (DashboardTitleBar, DesktopTopNav, AdminTopBar, DashboardHeader), and it
 * used to `import { AnimatePresence, motion } from "framer-motion"`
 * statically. That one line put ~38 kB gzip of framer on the critical path of
 * every signed-in page — measured by BFS over the built graph:
 *
 *     index -> DashboardTitleBar -> NotificationPanel -> proxy (framer-motion)
 *
 * The animation is only visible on rows inside the OPEN panel, so the import
 * is made dynamic here and triggered when the panel opens. Until it resolves
 * (one chunk fetch, usually already warm from a lazy route that uses framer),
 * the rows render as plain `<div>`s with identical classes and styles — the
 * same box, so nothing shifts. Only the enter/exit/layout animation of a row
 * that arrives or leaves in that window is skipped.
 *
 * `scripts/check-deferred-vendors.mjs` lists framer-motion as a deferred
 * vendor, so a static import that drags it back into the entry graph fails
 * the gate. Do not "simplify" this back to a static import.
 */
export type FramerMotion = typeof import("./framerRows");

let loaded: FramerMotion | null = null;
let pending: Promise<FramerMotion> | null = null;

function loadFramerMotion(): Promise<FramerMotion> {
  if (loaded) return Promise.resolve(loaded);
  if (!pending) {
    pending = import("./framerRows").then(
      (mod) => {
        loaded = mod;
        return mod;
      },
      (err: unknown) => {
        // A failed chunk fetch (offline, stale deploy) leaves the rows static
        // and fully usable; clear `pending` so the next open retries.
        pending = null;
        throw err;
      },
    );
  }
  return pending;
}

/** framer-motion once `when` has been true at least once and the chunk has arrived; `null` until then. */
export function useFramerMotion(when: boolean): FramerMotion | null {
  const [framer, setFramer] = useState<FramerMotion | null>(loaded);
  useEffect(() => {
    if (framer || !when) return;
    let alive = true;
    loadFramerMotion().then(
      (mod) => { if (alive) setFramer(mod); },
      (err: unknown) => report(err, { tags: { source: "NotificationPanel.loadFramerMotion" } }),
    );
    return () => { alive = false; };
  }, [framer, when]);
  return framer;
}
