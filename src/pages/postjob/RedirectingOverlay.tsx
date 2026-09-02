import { createPortal } from "react-dom";
import { HelprSpinner } from "@/components/ui/HelprSpinner";

/**
 * Blocking full-screen overlay shown from the moment the Stripe
 * redirect is triggered until the page unloads. Prevents re-taps
 * on a slow network; pointer-events:none on everything else.
 *
 * PORTALLED TO <body>, AND IT HAS TO BE. `fixed inset-0` is only relative to
 * the viewport when no ancestor establishes a containing block, and this is
 * mounted as a direct <AppPage> child — whose `animate-ds-page-in` ends on
 * `transform: translateY(0)` with `animation-fill-mode: forwards`, leaving a
 * permanent non-none transform. Measured in place: 329x696 inside a 393x852
 * viewport (83.7% x 81.7%), i.e. roughly 18% of the screen still live and
 * tappable during the Stripe redirect — on the one overlay whose entire job
 * is to stop a second tap. It looked correct in code and in a screenshot,
 * because what it covers IS the page content column.
 */
export function RedirectingOverlay() {
  if (typeof document === "undefined") return null;
  return createPortal(
    (
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
    ),
    document.body,
  );
}
