import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
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
