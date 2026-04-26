import { ReactNode, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface PremiumCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** "soft" = subtle card, "elevated" = stronger shadow + accent gradient */
  variant?: "soft" | "elevated";
  /** rounded-2xl (default) or rounded-3xl for hero/feature cards */
  size?: "md" | "lg";
}

/**
 * Premium card with glass-style background, soft shadow, and rounded corners.
 * Use as a drop-in replacement for plain `<div className="border bg-card">` blocks.
 */
export const PremiumCard = ({
  children,
  variant = "soft",
  size = "md",
  className,
  ...rest
}: PremiumCardProps) => {
  return (
    <div
      className={cn(
        "relative border border-border/60",
        size === "lg" ? "rounded-3xl" : "rounded-2xl",
        variant === "elevated"
          ? "bg-[image:var(--gradient-card-accent)] shadow-[var(--shadow-premium)]"
          : "bg-card shadow-[var(--shadow-card-soft)]",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
};

export default PremiumCard;
