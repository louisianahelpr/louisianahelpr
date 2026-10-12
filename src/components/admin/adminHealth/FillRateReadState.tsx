import { ErrorState } from "@/components/ui/ErrorState";

/**
 * Q1672: Admin Health's fill-rate card when its read fails. Never loaded: an
 * inline error with Retry instead of the cards, so a failed read never reads
 * as "no job data". Loaded once, then a refresh failed: the numbers stay,
 * dated, with a line saying they could not be refreshed.
 * Guard: src/components/admin/AdminHealth.fillRateUnreadable.test.tsx.
 */
export function FillRateReadFailed({ fetching, onRetry }: { fetching: boolean; onRetry: () => void }) {
  return (
    <ErrorState
      variant="inline"
      title="Couldn't load fill rate"
      body="The read behind these numbers failed, so none of them is shown rather than zeros."
      onRetry={onRetry}
      retryDisabled={fetching}
    />
  );
}

export function FillRateStaleNote({ stale, updatedAt }: { stale: boolean; updatedAt: number }) {
  if (!stale) return null;
  return (
    <p className="text-ds-12 font-medium text-destructive" role="status">
      Couldn't refresh fill rate. The numbers below are from {new Date(updatedAt).toLocaleTimeString()}.
    </p>
  );
}
