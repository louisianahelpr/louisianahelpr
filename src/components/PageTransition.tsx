import { ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * 2026 page transition: 280ms ease-out with translateY(8px → 0).
 * Defined in tailwind.config.ts as `animate-ds-page-in`.
 */
const PageTransition = ({ children }: PageTransitionProps) => (
  <div className="animate-ds-page-in">
    {children}
  </div>
);

export default PageTransition;
