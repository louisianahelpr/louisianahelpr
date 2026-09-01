import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        // Burnt-sienna accent chip for DECORATIVE / informational badges
        // (status tags, counts, "new") — the calm on-brand alternative to
        // `secondary`. Reserve `destructive` (mauve) for genuinely
        // destructive/danger states only. Tinted fill + sienna text so it
        // reads as an accent, not an alert. (Brand HSL tokens aren't wired
        // into the Tailwind theme, so they're referenced as arbitrary values.)
        sienna:
          "border-transparent bg-[hsl(var(--burnt-sienna)/0.12)] text-[hsl(var(--burnt-sienna))] hover:bg-[hsl(var(--burnt-sienna)/0.18)]",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
