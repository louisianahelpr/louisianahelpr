/**
 * Quotes on My Jobs and Posts (owner decision 2026-10-19: the /quotes hub
 * retired; quotes live where the jobs live):
 *   - Posts: "Your quote requests", each with the quotes that came in on it
 *     (open one to see and answer them on its request page);
 *   - My Jobs: "Your quotes", the quotes this member sent, with whose turn it
 *     is and the counter-offers to answer.
 * Every member sees both (never role-based). Mounted by JobListQuotesSlot only
 * while the hidden 'quotes' switch is on. With nothing to show it draws
 * nothing, unless a link asked for it (?quotes=1, QUOTE_HOMES), when it says
 * so instead and scrolls itself into view.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchMyJobQuotes, fetchMyQuoteRequests, type MyQuoteRequest } from "@/lib/quotes/api";
import { QUOTE_HOMES } from "@/lib/quotes/homes";
import { QuotesNotice, REQUEST_STATUS_LABEL, dayLabel, timeLeft } from "@/components/quotes/quotesUi";
import { MyQuoteCard } from "@/components/quotes/MyQuoteCard";

function RequestRow({ r }: { r: MyQuoteRequest }) {
  const left = r.status === "open" ? timeLeft(r.quotes_close_at) : "";
  return (
    <li>
      <Link
        to={`/quotes/request/${r.id}`}
        className="block rounded-2xl border border-border bg-card p-4 ctl-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quote request</p>
        <p className="mt-1 font-semibold text-foreground break-words">{r.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {REQUEST_STATUS_LABEL[r.status] ?? "Closed"}
          {" · "}
          {r.quote_count === 1 ? "1 quote" : `${r.quote_count} quotes`}
          {left ? ` · ${left}` : ""}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">Needed {dayLabel(r.date_needed)}</p>
      </Link>
    </li>
  );
}

function Section({ title, focus, className = "", children }: { title: string; focus: boolean; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView?.({ block: "start" });
  }, [focus]);
  return (
    <section ref={ref} aria-label={title} className={`mb-4 ${className}`} data-job-list-quotes>
      <h2 className="mb-2 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function PosterRequests({ focus, className }: { focus: boolean; className?: string }) {
  const q = useQuery({ queryKey: ["quotes", "my-requests"], queryFn: fetchMyQuoteRequests });
  if (q.isPending) return focus ? <p role="status" className={`mb-4 ${className ?? ""} text-sm text-muted-foreground`}>Loading your quote requests…</p> : null;
  if (q.isError) return <Section title="Your quote requests" focus={focus} className={className}><ErrorState variant="inline" onRetry={() => void q.refetch()} /></Section>;
  if (q.data.length === 0) {
    if (!focus) return null;
    return (
      <Section title="Your quote requests" focus={focus} className={className}>
        <QuotesNotice title="You haven't asked for quotes yet">
          Not sure what a job should cost? On Post a Job, pick Get quotes and local members send you their price.
        </QuotesNotice>
      </Section>
    );
  }
  return (
    <Section title="Your quote requests" focus={focus} className={className}>
      <ul className="space-y-list">
        {q.data.map((r) => <RequestRow key={r.id} r={r} />)}
      </ul>
    </Section>
  );
}

function SentQuotes({ focus, className }: { focus: boolean; className?: string }) {
  const q = useQuery({ queryKey: ["quotes", "mine"], queryFn: fetchMyJobQuotes });
  if (q.isPending) return focus ? <p role="status" className={`mb-4 ${className ?? ""} text-sm text-muted-foreground`}>Loading your quotes…</p> : null;
  if (q.isError) return <Section title="Your quotes" focus={focus} className={className}><ErrorState variant="inline" onRetry={() => void q.refetch()} /></Section>;
  if (q.data.length === 0) {
    if (!focus) return null;
    return (
      <Section title="Your quotes" focus={focus} className={className}>
        <QuotesNotice title="You haven't sent any quotes yet">
          <Link to={QUOTE_HOMES.openRequests} className="underline underline-offset-2">Jobs that want quotes</Link> are in Jobs.
        </QuotesNotice>
      </Section>
    );
  }
  return (
    <Section title="Your quotes" focus={focus} className={className}>
      <ul className="space-y-list">
        {q.data.map((mq) => <MyQuoteCard key={mq.id} quote={mq} />)}
      </ul>
    </Section>
  );
}

export function JobListQuotes({ tab, focus, className }: { tab: "posted" | "applied"; focus: boolean; className?: string }) {
  return tab === "posted" ? <PosterRequests focus={focus} className={className} /> : <SentQuotes focus={focus} className={className} />;
}
