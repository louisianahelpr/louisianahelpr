import { Navigate, useLocation } from "react-router-dom";
import { quotesHubTarget } from "@/lib/quotes/homes";

/** /quotes, retired (owner 2026-10-19): sends an old hub link to its new home. */
export default function QuotesHubRedirect() {
  const { search } = useLocation();
  return <Navigate to={quotesHubTarget(search)} replace />;
}
