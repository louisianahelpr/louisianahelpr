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

/**
 * F043 (owner UI audit 11-09): the member read technical field names ("Route", "App build", "Recent errors 1 (last 10
 * kept)"). The list folds behind "What we'll send with your report" (still one tap away, still exactly what is sent,
 * Q1028) and reads in plain words. The report the team gets keeps its own labels (bugReportBlock).
 */
const PLAIN_LABEL: Readonly<Record<string, string>> = {
  Screen: "Page you were on",
  Route: "Web address",
  "Screen size": "Screen size",
  Device: "Device",
  "App build": "App version",
  "Recent errors": "Problems the app noticed",
};

export function BugReportAttachments({ context }: { context: BugReportContext }) {
  const items = bugReportItems(context);
  return (
    <details data-bug-report-attachments="" className="group rounded-ds-md border border-border/60 bg-secondary/30 px-4 py-3">
      <summary className="cursor-pointer list-none text-ds-13 font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        What we'll send with your report
      </summary>
      <p className="mt-1 text-ds-11 text-muted-foreground">So we can see what went wrong. No photos, passwords or card details.</p>
      <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-ds-11">
        {items.map((i) => (
          <div key={i.label} className="contents">
            <dt className="text-muted-foreground">{PLAIN_LABEL[i.label] ?? i.label}</dt>
            <dd className="min-w-0 break-words text-foreground">{i.label === "Recent errors" ? (context.errors.length ? String(context.errors.length) : "None") : i.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
