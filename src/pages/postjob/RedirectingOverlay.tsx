import { HelprSpinner } from "@/components/ui/HelprSpinner";

/**
 * Blocking full-screen overlay shown from the moment the Stripe
 * redirect is triggered until the page unloads. Prevents re-taps
 * on a slow network; pointer-events:none on everything else.
 */
export function RedirectingOverlay() {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4"
      style={{ background: "hsl(var(--surface-band) / 0.94)", backdropFilter: "blur(6px)" }}
      aria-live="assertive"
      aria-label="Redirecting to secure checkout"
    >
      {/* delay=0 — Stripe redirect always takes well over a second, so
          we want the branded mark visible the instant we mount. */}
      <HelprSpinner size={44} delay={0} />
      <p className="font-display font-bold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
        Taking you to secure checkout…
      </p>
      <p className="text-ds-11 text-muted-foreground">Please don't close this page</p>
    </div>
  );
}
