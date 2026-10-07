import { useMemo } from "react";
import { bugReportContext, bugReportItems, type BugReportContext } from "@/lib/bugReportContext";

/**
 * What a "Something's not working" report attaches, shown BEFORE it is sent
 * (owner, 2026-10-07, Q1028: "showing the list of what gets attached before
 * sending"). Both support forms render it under the message field when that
 * topic is chosen, and send exactly the context it shows.
 */
export function useBugReportContext(active: boolean): BugReportContext | null {
  // Read once when the topic is chosen: the list the person reads is the list that is sent.
  return useMemo(() => (active ? bugReportContext() : null), [active]);
}

export function BugReportAttachments({ context }: { context: BugReportContext }) {
  const items = bugReportItems(context);
  return (
    <section aria-labelledby="bug-report-attachments" className="rounded-ds-md border border-border/60 bg-secondary/30 px-4 py-3">
      <h3 id="bug-report-attachments" className="text-ds-11 font-semibold text-foreground">
        Attached automatically
      </h3>
      <p className="mt-0.5 text-ds-11 text-muted-foreground">So we can see what went wrong. No photos, passwords or card details.</p>
      <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-ds-11">
        {items.map((i) => (
          <div key={i.label} className="contents">
            <dt className="text-muted-foreground">{i.label}</dt>
            <dd className="min-w-0 break-words text-foreground">{i.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
