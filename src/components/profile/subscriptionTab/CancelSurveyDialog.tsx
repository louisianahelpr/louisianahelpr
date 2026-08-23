import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";

// Cancellation drag survey — gentle "are you sure" with a stay
// offer before Stripe portal opens. Reduces churn at the
// moment of intent, before the user has committed to leaving.
export const CancelSurveyDialog = ({
  cancelSurveyOpen,
  setCancelSurveyOpen,
  currentTier,
  openStripePortal,
}: {
  cancelSurveyOpen: boolean;
  setCancelSurveyOpen: (open: boolean) => void;
  currentTier: string | null;
  openStripePortal: () => void;
}) => {
  return (
    <Dialog open={cancelSurveyOpen} onOpenChange={setCancelSurveyOpen}>
      <DialogContent className="!gap-3">
        <DialogHero
          eyebrow="Before you go"
          title="Thinking of Cancelling?"
        />
        <div className="space-y-2">
          {[
            "Too expensive",
            "Not enough jobs match me",
            "Took a break — coming back later",
            "Different reason — just managing my plan",
          ].map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={async () => {
                // Log the reason via Slack alert so retention has signal.
                // Fire-and-forget; the portal redirect doesn't wait.
                try {
                  const { fireSlackAlert } = await import("@/lib/slackAlerts");
                  fireSlackAlert({
                    kind: "custom",
                    severity: "info",
                    title: "Subscription cancel-intent",
                    message: `User indicated reason: ${reason}`,
                    fields: { tier: currentTier ?? "unknown", reason },
                  });
                } catch { /* analytics is best-effort */ }
                setCancelSurveyOpen(false);
                void openStripePortal();
              }}
              className="w-full text-left px-4 py-3 rounded-ds-md transition-all active:scale-[0.99]"
              style={{
                background: "hsla(0, 0%, 100%, 0.55)",
                border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                color: "hsl(var(--ink-deep))",
                fontFamily: "Bodoni Moda, Garamond, serif",
                fontStyle: "italic",
                fontSize: "0.92rem",
              }}
            >
              {reason}
            </button>
          ))}
        </div>
        <div
          className="rounded-ds-md p-3 mt-1"
          style={{
            background: "hsl(var(--amber-tint) / 0.10)",
            border: "0.5px solid hsl(var(--amber-tint) / 0.32)",
          }}
        >
          <p
            className="font-serif italic leading-snug text-ds-12"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
              Reach out before you cancel.
            </span>{" "}
            Email{" "}
            <a
              href="mailto:admin@louisianahelpr.com?subject=Considering cancelling — can we help?"
              className="underline"
              style={{ color: "hsl(var(--bark))" }}
            >
              admin@louisianahelpr.com
            </a>{" "}
            and we'll see what we can do — including discounted retention rates.
          </p>
        </div>
        <DialogFooter className="!gap-2">
          <Button variant="ghost" onClick={() => setCancelSurveyOpen(false)} className="rounded-ds-md">
            Never mind
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
