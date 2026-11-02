import type { HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * A Declutter list with nothing in it yet (owner 2026-10-28: designed empty states, not a bare grey sentence): the
 * list's icon on the olive tint, what will show here, and when. A dashed edge: the slot the first one fills.
 * Selling's empties wore it first (DeclutterTabParts); Q2568/Q2577 (audit 1102a) gave Wanted's and Deliver's empties
 * the same card. Guards: declutterWantedForm.test.tsx (hub empties) and deliverAcceptConfirms.test.tsx (Deliver).
 */
export function DeclutterEmptyCard({ icon: Icon, title, children, action, ...rest }: {
  icon: LucideIcon; title: string; children: ReactNode;
  /** Q2639: the list's one way to fill it (Your listings: Sell an item), under the words. */
  action?: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-empty-card="" className="flex items-start gap-3 rounded-[20px] border border-dashed border-border bg-card/60 px-4 py-4" {...rest}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--olive)/0.35)] text-[hsl(var(--bark))]" aria-hidden>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <p className="text-ds-15 font-semibold">{title}</p>
        <p className="text-ds-13 text-muted-foreground">{children}</p>
        {action}
      </div>
    </div>
  );
}
