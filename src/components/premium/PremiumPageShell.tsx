import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PremiumPageShellProps {
  children: ReactNode;
  className?: string;
  /** Show ambient gradient orbs in the background. Default true. */
  orbs?: boolean;
  /** Use a tighter container padding for dense in-app screens. */
  dense?: boolean;
}

/**
 * Wraps any page in the premium look:
 * - Soft page gradient background
 * - Two ambient color orbs (top-right primary, bottom-left accent)
 * - Centered max-w container with consistent padding
 *
 * Drop this around any page's existing content for instant cohesion.
 */
export const PremiumPageShell = ({
  children,
  className,
  orbs = true,
  dense = false,
}: PremiumPageShellProps) => {
  return (
    <div
      className={cn(
        "relative min-h-screen overflow-hidden",
        "bg-[image:var(--gradient-page)]",
        className
      )}
    >
      {orbs && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute -top-40 -right-32 w-[520px] h-[520px] rounded-full bg-primary/15 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-40 -left-32 w-[480px] h-[480px] rounded-full bg-accent/20 blur-3xl"
          />
        </>
      )}
      <div
        className={cn(
          "relative",
          dense ? "px-4 py-4" : "container mx-auto px-5 py-6"
        )}
      >
        {children}
      </div>
    </div>
  );
};

export default PremiumPageShell;
