import { ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

const PageTransition = ({ children }: PageTransitionProps) => (
  <div className="animate-in fade-in duration-150">
    {children}
  </div>
);

export default PageTransition;
