import type { ReactNode } from "react";
import type { MotionProps } from "framer-motion";
import type { FramerMotion } from "@/components/notificationPanel/useFramerMotion";

/* One day group. When the LAST row of a day leaves (mark read on the Unread
   tab), the whole section unmounts, not just the row — so the section needs
   the same collapsing exit the rows have, or the panel's bottom edge jumps by
   header + row in one frame. See `collapseExit` inside the component. A plain
   <section> until framer has loaded, same as the rows. */
export const DaySection = ({
  framer,
  exit,
  transition,
  children,
}: {
  framer: FramerMotion | null;
  exit: MotionProps["exit"];
  transition: MotionProps["transition"];
  children: ReactNode;
}) =>
  framer ? (
    <framer.motion.section exit={exit} transition={transition}>
      {children}
    </framer.motion.section>
  ) : (
    <section>{children}</section>
  );
