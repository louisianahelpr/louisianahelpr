/**
 * /quotes: quotes on jobs (owner Q1-Q8). Three views on one page:
 *   - Your requests: the jobs this member asked quotes for (open one to see
 *     its quotes and answer them).
 *   - Open requests: jobs other members want quotes for (send a quote).
 *   - Your quotes: the quotes this member sent, whose turn it is, and the
 *     counter-offers to answer.
 * Every member sees all three (never role-based). Hidden unless the 'quotes'
 * switch is on for the member (QuotesGate). Notifications link here with
 * ?user=<actor> for the seed boundary; the page ignores that parameter.
 */
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import {
  fetchMyJobQuotes,
  fetchMyQuoteRequests,
  fetchOpenQuoteRequests,
  type MyJobQuote,
  type MyQuoteRequest,
  type OpenQuoteRequest,
} from "@/lib/quotes/api";
import { QuotesGate, QuotesNotice, REQUEST_STATUS_LABEL, dayLabel, timeLeft } from "@/components/quotes/quotesUi";
import { MyQuoteCard } from "@/components/quotes/MyQuoteCard";

type View = "requests" | "open" | "mine";
const VIEWS: View[] = ["requests", "open", "mine"];

function RequestRow({ r }: { r: MyQuoteRequest }) {
  const left = r.status === "open" ? timeLeft(r.quotes_close_at) : "";
  return (
    <li>
      <Link
        to={`/quotes/request/${r.id}`}
        className="block rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <p className="font-semibold text-foreground break-words">{r.title}</p>
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

function YourRequests() {
  const navigate = useNavigate();
  // Q1586(c): Post a Job is greyed out under 18, here as on every entry to it.
  const { underAge } = useAgeGate();
  const q = useQuery({ queryKey: ["quotes", "my-requests"], queryFn: fetchMyQuoteRequests });
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading your requests…</p>;
  if (q.isError) return <ErrorState variant="inline" onRetry={() => void q.refetch()} />;
  if (q.data.length === 0) {
    return (
      <QuotesNotice title="You haven't asked for quotes yet">
        <p>Not sure what a job should cost? On Post a Job, pick Get quotes and local members send you their price.</p>
        <Button type="button" size="sm" className="mt-3" disabled={underAge} onClick={() => navigate("/post-job")}>
          Post a Job
        </Button>
      </QuotesNotice>
    );
  }
  return (
    <ul className="space-y-3" aria-label="Your quote requests">
      {q.data.map((r) => (
        <RequestRow key={r.id} r={r} />
      ))}
    </ul>
  );
}

function OpenRow({ r }: { r: OpenQuoteRequest }) {
  const quoted = !!r.my_quote_id;
  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <p className="font-semibold text-foreground break-words">{r.title}</p>
      <p className="mt-1 text-sm text-muted-foreground line-clamp-3 break-words">{r.description}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Needed {dayLabel(r.date_needed)}
        {r.location ? ` · ${r.location}` : r.parish ? ` · ${r.parish}` : ""}
        {timeLeft(r.quotes_close_at) ? ` · ${timeLeft(r.quotes_close_at)}` : ""}
      </p>
      <div className="mt-3">
        {quoted ? (
          <p className="text-sm font-medium text-foreground">You sent a quote. See it under Your quotes.</p>
        ) : (
          <Button asChild size="sm">
            <Link to={`/quotes/send/${r.id}`}>Send a quote</Link>
          </Button>
        )}
      </div>
    </li>
  );
}

function OpenRequests() {
  const q = useQuery({ queryKey: ["quotes", "open"], queryFn: fetchOpenQuoteRequests });
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading open requests…</p>;
  if (q.isError) return <ErrorState variant="inline" onRetry={() => void q.refetch()} />;
  if (q.data.length === 0) {
    return (
      <QuotesNotice title="No open requests right now">
        When someone near you asks for quotes on a job, it shows up here.
      </QuotesNotice>
    );
  }
  return (
    <ul className="space-y-3" aria-label="Open quote requests">
      {q.data.map((r) => (
        <OpenRow key={r.id} r={r} />
      ))}
    </ul>
  );
}

function YourQuotes() {
  const q = useQuery({ queryKey: ["quotes", "mine"], queryFn: fetchMyJobQuotes });
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading your quotes…</p>;
  if (q.isError) return <ErrorState variant="inline" onRetry={() => void q.refetch()} />;
  if (q.data.length === 0) {
    return (
      <QuotesNotice title="You haven't sent any quotes yet">
        Open requests lists the jobs you can quote on.
      </QuotesNotice>
    );
  }
  return (
    <ul className="space-y-3" aria-label="Your quotes">
      {q.data.map((mq: MyJobQuote) => (
        <MyQuoteCard key={mq.id} quote={mq} />
      ))}
    </ul>
  );
}

function QuotesHome() {
  const { user } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const raw = params.get("view") as View | null;
  const view: View = raw && VIEWS.includes(raw) ? raw : "requests";
  if (!user) return null;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Ask for prices on a job, or send your price for someone else's.
      </p>
      <SegmentedControl
        ariaLabel="Quotes view"
        semantics="tab"
        value={view}
        onChange={(v) => setParams(v === "requests" ? {} : { view: v }, { replace: true })}
        options={[
          { value: "requests", label: "Your requests" },
          { value: "open", label: "Open requests" },
          { value: "mine", label: "Your quotes" },
        ]}
      />
      <div className="mt-4 pb-safe-nav">
        {view === "requests" ? <YourRequests /> : view === "open" ? <OpenRequests /> : <YourQuotes />}
      </div>
    </>
  );
}

export default function QuotesPage() {
  return (
    <QuotesGate title="Quotes" backTo="/posts" label="Loading quotes">
      <AppPage title="Quotes" backTo="/posts">
        <QuotesHome />
      </AppPage>
    </QuotesGate>
  );
}
