/**
 * Blocking full-screen overlay shown from the moment the Stripe
 * redirect is triggered until the page unloads. Prevents re-taps
 * on a slow network; pointer-events:none on everything else.
 */
export function RedirectingOverlay() {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4"
      style={{ background: "hsla(38, 18%, 97%, 0.94)", backdropFilter: "blur(6px)" }}
      aria-live="assertive"
      aria-label="Redirecting to secure checkout"
    >
      <svg
        className="animate-spin"
        style={{ width: 40, height: 40, color: "hsl(var(--bark))" }}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <p className="font-display font-bold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
        Taking you to secure checkout…
      </p>
      <p className="text-ds-11 text-muted-foreground">Please don't close this page</p>
    </div>
  );
}
