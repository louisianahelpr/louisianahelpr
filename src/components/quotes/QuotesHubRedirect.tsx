import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import AppPage from "@/components/AppPage";
import { ErrorState } from "@/components/ui/ErrorState";
import { useAuthReady } from "@/hooks/useAuthReady";
import { useFeatureStatus } from "@/hooks/useFeature";
import { isMyQuoteRequest } from "@/lib/quotes/api";
import { quoteRequestTarget, quotesHubTarget } from "@/lib/quotes/homes";

/**
 * /quotes, retired (owner 2026-10-19): sends an old hub link to its new home.
 *
 * A quote notice links '/quotes?request=<id>' (Q2177): which side the reader
 * is on is read from that one request NOW (did they post it?), so the poster
 * lands on the request's page and the quoter on the quotes they sent. Signed
 * out, or with the quotes switch off for them, there is nothing to read: the
 * old-link rule sends them on (and the target's own gates take over).
 */
export default function QuotesHubRedirect() {
  const { search } = useLocation();
  const { user, isReady } = useAuthReady();
  const quotes = useFeatureStatus("quotes");
  const requestId = new URLSearchParams(search).get("request");
  const uid = user?.id ?? null;
  const own = useQuery({
    queryKey: ["quotes", "is-my-request", requestId, uid],
    queryFn: () => isMyQuoteRequest(requestId!, uid!),
    enabled: !!requestId && !!uid && quotes.on,
  });
  const fallback = <Navigate to={quotesHubTarget(search)} replace />;
  if (!requestId || (isReady && !uid) || (quotes.settled && !quotes.on)) return fallback;
  if (own.isError) {
    return (
      <AppPage title="Quotes" backTo="/home">
        <ErrorState variant="inline" onRetry={() => void own.refetch()} />
      </AppPage>
    );
  }
  if (!own.isSuccess) {
    return (
      <AppPage title="Quotes" backTo="/home">
        <p className="sr-only" role="status">Loading</p>
      </AppPage>
    );
  }
  return <Navigate to={quoteRequestTarget(requestId, own.data)} replace />;
}
