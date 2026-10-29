import { Users } from "lucide-react";
import type { HelprActivity } from "@/hooks/useHelprActivity";

/**
 * Two-sided liquidity signal on Review: a quiet confidence cue that the Helpr side is active before the
 * poster commits. The count is Helprs who've worked at least one job in this parish (get_parish_activity),
 * so the copy says exactly that, never an invented "active this week" figure. Renders only when the count
 * is meaningful (>= 3, decided by useHelprActivity). Moved out of CheckoutStep (A2-C32) unchanged.
 */
export function HelprActivityNote({ activity }: { activity: HelprActivity | null }) {
  if (!activity) return null;
  return (
    <div
      className="flex items-center gap-2.5 rounded-ds-md px-3 py-2"
      style={{
        background: "hsl(var(--primary) / 0.06)",
        border: "0.5px solid hsl(var(--primary) / 0.22)",
      }}
    >
      <Users className="w-4 h-4 text-primary shrink-0" strokeWidth={2.25} />
      <p className="text-ds-12 leading-snug text-foreground">
        <span className="font-sans font-bold tabular-nums">
          {activity.count} Helprs
        </span>{" "}
        <span className="text-muted-foreground">
          have worked jobs in {activity.parish} Parish — your
          job will reach an active community.
        </span>
      </p>
    </div>
  );
}
