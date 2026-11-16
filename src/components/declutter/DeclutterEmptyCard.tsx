import type { HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * A Declutter list with nothing in it yet (owner 2026-10-28: designed empty states, not a bare grey sentence): the
 * list's icon, what will show here, and when. Selling's empties wore it first (DeclutterTabParts); Q2568/Q2577 (audit
 * 1102a) gave Wanted's and Deliver's empties the same card. M5 (iOS design audit 11-16): drawn by the shared
 * EmptyState's `compact` variant, no longer a dashed card of its own. Guards: declutterWantedForm.test.tsx (hub
 * empties), deliverAcceptConfirms.test.tsx (Deliver) and src/test/emptyStatesOneComponent.test.ts.
 */
export function DeclutterEmptyCard({ icon, title, children, action, ...rest }: {
  icon: LucideIcon; title: string; children: ReactNode;
  /** Q2639: the list's one way to fill it (Your listings: Sell an item), under the words. */
  action?: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-empty-card="" {...rest}>
      <EmptyState variant="compact" icon={icon} title={title} body={children} action={action} />
    </div>
  );
}
