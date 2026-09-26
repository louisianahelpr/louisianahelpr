/**
 * The quiet "reloading" state every error boundary shows while a stale-chunk
 * recovery reload is starting or scheduled (recoverFromChunkError() returned
 * true, or isRecoveryReloadInFlight()). The page is on its way out, so an
 * error card here would be a false error the visitor reads (Q199, Q286).
 *
 * Inline SVG, not lucide-react: ErrorBoundary and RouteErrorBoundary are
 * statically imported and must not pull the lucide chunk onto the entry.
 */
export const ChunkRecoveringState = ({ compact = false }: { compact?: boolean }) => (
  <div
    className={
      compact
        ? "my-3 flex items-center justify-center gap-2 p-5 text-center"
        : "min-h-[60vh] flex flex-col items-center justify-center gap-3 p-8 text-center"
    }
    role="status"
    data-testid="chunk-recovering"
  >
    <span style={{ color: "hsl(var(--bark))" }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`${compact ? "h-4 w-4" : "h-6 w-6"} motion-safe:animate-spin`}
        aria-hidden="true"
      >
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M8 16H3v5" />
      </svg>
    </span>
    <p className="font-sans text-ds-14" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
      Loading…
    </p>
  </div>
);
