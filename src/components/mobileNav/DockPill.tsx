import type { CSSProperties } from "react";
import { useDockMotion } from "./useDockMotion";

/**
 * The dock's sliding active-tab marker (the shared `layoutId` pill and the
 * underline dot). Until the dock's framer chunk has arrived this is the plain
 * `<span>` a framer pill renders anyway: same element, classes and inline
 * style, so the first frame is pixel-identical. Once it has arrived the pill
 * is the SharedLayoutPill (src/components/ui/SharedLayoutPill.tsx), which
 * slides between tabs. See useDockMotion.ts for why (Q1172).
 */
export function DockPill({
  layoutId,
  className,
  style,
  transition,
}: {
  layoutId: string;
  className: string;
  style: CSSProperties;
  transition: { duration: number } | { type: "spring"; stiffness: number; damping: number };
}) {
  const motion = useDockMotion();
  if (!motion) return <span className={className} style={style} aria-hidden />;
  const { SharedLayoutPill } = motion;
  return <SharedLayoutPill layoutId={layoutId} className={className} style={style} transition={transition} aria-hidden />;
}
