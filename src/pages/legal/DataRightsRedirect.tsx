import { Navigate } from "react-router-dom";
import { useAuthReady } from "@/hooks/useAuthReady";
import { dataRightsTarget } from "./dataExportAnchor";

/**
 * `/data-rights` — kept as a route because the iOS App Store privacy listing
 * points at it. The destination depends on who is asking (see
 * `dataRightsTarget`), so it waits for the auth snapshot to settle before
 * choosing: deciding from a still-restoring `user: null` would send a signed-in
 * reader to the public page and leave them there.
 *
 * Lazy-loaded from App.tsx: `useAuthReady` pulls the Supabase client, which
 * must not land in the entry chunk.
 */
export default function DataRightsRedirect() {
  const { user, isReady } = useAuthReady();
  if (!isReady) return <div className="min-h-screen bg-premium-page" />;
  return <Navigate to={dataRightsTarget(!!user)} replace />;
}
