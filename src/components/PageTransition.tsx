import { ReactNode } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigationType } from "react-router-dom";

import { useReducedMotion } from "@/lib/accessibility";

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Direction-aware native-style page transition.
 *
 * iOS navigation reads as a horizontal slide, not a web-page fade:
 *   - A forward navigation (PUSH / REPLACE) slides the incoming screen
 *     in from the right.
 *   - A back navigation (POP) slides it in from the left.
 *
 * The previous screen is unmounted by React Router immediately, so we
 * only animate the *incoming* screen — a self-contained enter animation,
 * which avoids needing AnimatePresence or a shared layout shell.
 *
 * Keyed by location.key so every navigation (even same-component route
 * changes) replays the animation.
 *
 * Respects `prefers-reduced-motion`: falls back to a plain opacity fade
 * with no translation.
 */
const PageTransition = ({ children }: PageTransitionProps) => {
  const location = useLocation();
  const navigationType = useNavigationType();
  const reducedMotion = useReducedMotion();

  // POP = back navigation. PUSH/REPLACE = forward.
  const isBack = navigationType === "POP";

  // 24px feels native on a phone — enough to read as motion, small enough
  // to stay snappy. Incoming-from-right on push, incoming-from-left on pop.
  const offsetX = reducedMotion ? 0 : isBack ? -24 : 24;

  return (
    <motion.div
      key={location.key}
      initial={{ opacity: 0, x: offsetX }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: reducedMotion ? 0.18 : 0.28,
        // Matches the design system's `ds-out` easing curve.
        ease: [0.22, 1, 0.36, 1],
      }}
      style={{ willChange: "transform, opacity" }}
    >
      {children}
    </motion.div>
  );
};

export default PageTransition;
