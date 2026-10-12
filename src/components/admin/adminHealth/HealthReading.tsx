import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * A reading whose read has not answered yet (Q1287). useInstantQuery hands
 * back its fallback's zeros until then, and those painted as real numbers:
 * "0 sent", "0 unresolved", Job Activity all 0, on every cold load. A pending
 * reading is a placeholder bone, never the fallback. Guard:
 * src/components/admin/AdminHealth.coldLoad.test.tsx.
 */
export const Reading = ({ pending, bone, children }: { pending: boolean; bone: string; children: ReactNode }) =>
  pending ? <Skeleton data-pending-reading="" aria-hidden="true" className={bone} /> : <>{children}</>;

/** One Job Activity count: the number (a bone while pending) over its label. */
export const ActivityCount = ({ pending, value, label, tone }: { pending: boolean; value: number; label: string; tone: string }) => (
  <div className="text-center">
    <Reading pending={pending} bone="mx-auto h-8 w-10">
      <p className={cn("text-ds-24 font-bold", tone)}>{value}</p>
    </Reading>
    <p className="text-ds-11 text-muted-foreground">{label}</p>
  </div>
);

/** One Push Tokens tile: its label over the count (a bone while pending). */
export const PushTile = ({ pending, label, value }: { pending: boolean; label: string; value: number }) => (
  <div className="rounded-ds-sm bg-background/50 border border-border/40 p-3">
    <div className="text-ds-10 uppercase tracking-wider text-muted-foreground">{label}</div>
    <Reading pending={pending} bone="mt-1 h-8 w-10">
      <div className="text-ds-24 font-semibold tabular-nums">{value}</div>
    </Reading>
  </div>
);
