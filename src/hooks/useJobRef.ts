/**
 * Capture the `?ref=` source token from the current URL on mount.
 *
 * Drop this hook into any job detail view. On the first render it reads
 * `searchParams.get("ref")`, validates it against the known token registry
 * (see `src/lib/jobLinkRef.ts`), persists it to sessionStorage, and returns
 * the value so the host can tag analytics events.
 *
 * The effect runs only once (empty dep array) — re-renders caused by other
 * query-param changes won't overwrite a ref that was already captured.
 *
 * Usage:
 *   const ref = useJobRef(); // "msg" | "notif" | "share" | "email" | null
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { captureJobRef, type JobLinkRef } from "@/lib/jobLinkRef";

export function useJobRef(): JobLinkRef | null {
  const [searchParams] = useSearchParams();
  const [ref, setRef] = useState<JobLinkRef | null>(null);

  useEffect(() => {
    const captured = captureJobRef(searchParams.get("ref"));
    setRef(captured);
  // Empty dep array is intentional: capture once on mount. Re-renders from
  // other query param changes must not overwrite an already-captured ref.
  }, []);

  return ref;
}
