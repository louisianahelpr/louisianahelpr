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
import { Skeleton } from "@/components/ui/skeleton";

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

/** The page shell while the switch answer loads: the real title, bones below. */
function QuotesSkeleton({ title }: { title: string }) {
  return (
    <AppPage title={title} backTo="/posts">
      <div className="space-y-3" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </AppPage>
  );
}

/**
 * Renders the quote screens only when the hidden 'quotes' switch is on for
 * this member; a settled "off" is the 404, exactly as if the route did not
 * exist. Never the protection on its own: every quote RPC refuses too.
 */
export function QuotesGate({ title, children }: { title: string; children: ReactNode }) {
  const enabled = useFeature("quotes");
  const { user, isReady } = useAuthReady();
  const qc = useQueryClient();
  if (enabled) return <>{children}</>;
  const state = qc.getQueryState(["feature-enabled", "quotes", user?.id ?? null]);
  const settled = isReady && (!user || state?.status === "success" || state?.status === "error");
  return settled ? <NotFound /> : <QuotesSkeleton title={title} />;
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
