import { useEffect, useRef } from "react";
import { motion, visualElementStore, type HTMLMotionProps } from "framer-motion";

/**
 * The ONE way this app renders a framer shared-layout (`layoutId`) element:
 * the sliding "active tab" pill. Same props as `motion.span`, plus a release
 * of framer's layout stack when the whole group goes away.
 *
 * Why (PD-009, measured 2026-09-25): framer keeps every `layoutId` in a
 * `NodeStack` on the document-global root projection node (`sharedNodes`).
 * `NodeStack.remove()` only re-points `lead` when another member is left, so
 * when the LAST pill unmounts — the user navigated off the page — `lead` and
 * `prevLead` keep pointing at the dead projection nodes for the life of the
 * app. Each dead node's `parent` is the unmounted page's `PageTransition`
 * motion.div, whose drag feature closes over its DOM: the whole previous page
 * (239 DOM nodes on /legal, plus its fibers and listeners) stays alive. Still
 * true in framer-motion/motion-dom 13.4.4.
 *
 * The release runs in a PASSIVE effect cleanup on purpose. Switching tabs
 * unmounts the old pill and mounts the new one in one commit; by the time
 * passive cleanups run, the new pill has joined the stack, so `members` is
 * non-empty and nothing is touched — the slide animation (which resumes from
 * `prevLead`) is exactly as before. Only when nothing replaced the pill is the
 * stack dropped from the root, so its dead nodes can be collected.
 *
 * Guarded by src/test/sharedLayoutIdGoesThroughPill.test.ts (no raw
 * `layoutId` anywhere else) and e2e/memory/route-retention.spec.ts (detached
 * DOM after route round-trips).
 */

/** The slice of framer's projection node this needs (motion-dom's IProjectionNode). */
interface SharedLayoutNode {
  root?: { sharedNodes?: Map<string, { members: unknown[] }> };
}

/** Drop the `layoutId` stack from framer's root once no pill is left in it. Exported for the unit test. */
export function releaseSharedLayout(node: SharedLayoutNode | undefined, layoutId: string): boolean {
  const stacks = node?.root?.sharedNodes;
  const stack = stacks?.get(layoutId);
  if (!stacks || !stack || stack.members.length > 0) return false;
  stacks.delete(layoutId);
  return true;
}

type SharedLayoutPillProps = Omit<HTMLMotionProps<"span">, "ref" | "layoutId"> & { layoutId: string };

export function SharedLayoutPill({ layoutId, ...props }: SharedLayoutPillProps) {
  const el = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    // Captured at mount: after unmount the element is gone from the store's key.
    const node = el.current
      ? (visualElementStore.get(el.current)?.projection as SharedLayoutNode | undefined)
      : undefined;
    return () => {
      releaseSharedLayout(node, layoutId);
    };
  }, [layoutId]);
  return <motion.span ref={el} layoutId={layoutId} {...props} />;
}
