import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AccentSectionHeaderProps {
  children: ReactNode;
  className?: string;
  as?: "h2" | "h3" | "p";
  size?: "sm" | "md" | "lg";
}

/**
 * Section header with the signature primary accent bar to its left.
 * Use for grouping content within cards and pages.
 */
export const AccentSectionHeader = ({
  children,
  className,
  as: Tag = "p",
  size = "md",
}: AccentSectionHeaderProps) => {
  const sizeClass =
    size === "lg"
      ? "text-base font-bold"
      : size === "sm"
        ? "text-xs font-semibold uppercase tracking-wide"
        : "text-sm font-semibold";
  const barHeight = size === "lg" ? "h-5" : size === "sm" ? "h-3" : "h-4";

  return (
    <Tag className={cn("flex items-center gap-2", sizeClass, className)}>
      <span className={cn("w-1 rounded-full bg-primary", barHeight)} />
      {children}
    </Tag>
  );
};

export default AccentSectionHeader;
