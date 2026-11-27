import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CardDisclosureHeader } from "@/components/ui/CardDisclosureHeader";

/**
 * Owner 2026-11-20 (ease batch, item 1): on Post a job, photos, details and extras are optional and folded away, so
 * each step shows only what it asks. One card with the shared disclosure row (CardDisclosureHeader); it opens by
 * itself when something in it is already filled (a draft, a template, a repost), so nothing typed is ever hidden.
 * The fold stays mounted while closed (hidden), so its fields keep their state and the submit pass can still find them.
 */
export function OptionalExtras({ icon, title, summary, filled, children, testId }: {
  icon: LucideIcon;
  title: ReactNode;
  summary: ReactNode;
  /** Something inside is already set: start open. */
  filled: boolean;
  children: ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(filled);
  return (
    // Polish audit 11-27 #10: a flat group under a hairline, not a card inside the step. Guard: src/test/postJobNoCardsInCards1127.test.ts.
    <section className="border-t border-border [&>button]:px-0" data-flat-group="" data-testid={testId} data-open={open ? "" : undefined}>
      <CardDisclosureHeader icon={icon} title={title} summary={summary} open={open} onToggle={() => setOpen((o) => !o)} />
      <div hidden={!open} className="space-y-section pb-4">
        {children}
      </div>
    </section>
  );
}
