/**
 * Quotes on jobs: the gate and the small shared pieces of the quote screens
 * (/quotes, /quotes/request/:id, /quotes/send/:id). Plain words only: no
 * status codes reach the member.
 */
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFeature } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import NotFound from "@/pages/info/NotFound";
import AppPage from "@/components/AppPage";

/** What a quote's status reads as, from the reader's side. */
export const QUOTE_STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for an answer",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  closed: "Closed",
  expired: "Ran out of time",
};

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  open: "Taking quotes",
  agreed: "Price agreed",
  closed: "Posted at your price",
  cancelled: "Cancelled",
};

/**
 * The gate's frame while the switch's answer loads: the screen's real AppPage
 * header (same title, same back link) and NO bones. While 'quotes' is off the
 * answer is the 404 for every account, so bones there could only guess at a
 * page that never comes: measured 2026-10-15 (scripts/audit/measure-loading-states.mjs,
 * local build of ready/quotes, prod backend, both test accounts), the old three
 * bones swapped for the 404 with a -132px row and 2 -> 3 rows on all three routes. The
 * header holds the real title in its place and says it is loading; each page's
 * own loading state (switch on, data on its way) draws below it.
 */
function QuotesGateFrame({ title, backTo, label }: { title: string; backTo: string; label: string }) {
  return (
    <AppPage title={title} backTo={backTo}>
      <p role="status" className="sr-only">
        {label}
      </p>
    </AppPage>
  );
}

/**
 * Renders the quote screens only when the hidden 'quotes' switch is on for
 * this member; a settled "off" is the 404, exactly as if the route did not
 * exist. Never the protection on its own: every quote RPC refuses too.
 */
export function QuotesGate({ title, backTo, label, children }: { title: string; backTo: string; label: string; children: ReactNode }) {
  const enabled = useFeature("quotes");
  const { user, isReady } = useAuthReady();
  const qc = useQueryClient();
  if (enabled) return <>{children}</>;
  const state = qc.getQueryState(["feature-enabled", "quotes", user?.id ?? null]);
  const settled = isReady && (!user || state?.status === "success" || state?.status === "error");
  return settled ? <NotFound /> : <QuotesGateFrame title={title} backTo={backTo} label={label} />;
}

/** A plain-English block in place of a control the member cannot use. */
export function QuotesNotice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="status" className="rounded-2xl border border-border bg-card p-4 text-sm text-foreground">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-muted-foreground">{children}</div>}
    </div>
  );
}

/** "Sat, Oct 18" from a 'YYYY-MM-DD' date, read as a calendar day (no time zone shift). */
export function dayLabel(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "in 2 days" / "in 5 hours" / "less than an hour" until `iso`; "" once passed. */
export function timeLeft(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  if (!(ms > 0)) return "";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)} days left`;
  if (hours >= 1) return `${hours} ${hours === 1 ? "hour" : "hours"} left`;
  return "Less than an hour left";
}
