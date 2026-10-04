import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // Q1002: the bone animates with `shimmer`, not `animate-pulse`, and its
      // wrappers are usually aria-hidden, so the stuck-screen detectors
      // (e2e/errorScreens.ts detectStuckOrBlank, the prod-audit harness) saw
      // a page frozen on skeletons as loaded. They count this marker.
      data-skeleton=""
      className={cn(
        "rounded-md bg-[hsl(var(--olivewood)/0.10)] relative overflow-hidden",
        "after:absolute after:inset-0 after:translate-x-[-100%]",
        "after:bg-gradient-to-r after:from-transparent after:via-foreground/[0.06] after:to-transparent",
        "motion-safe:after:animate-[shimmer_2s_infinite]",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
