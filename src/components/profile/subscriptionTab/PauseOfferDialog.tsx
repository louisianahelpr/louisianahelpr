import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Loader2, PauseCircle } from "lucide-react";

// Pause-offer dialog — shown first when an active subscriber taps
// Manage. The lightest-touch retention move ("just pause for a
// month, free") is the first thing a leaving user sees; from
// here they can accept, route into the cancel survey, or back
// out. Reduces churn at the moment of intent.
export const PauseOfferDialog = ({
  pauseOfferOpen,
  setPauseOfferOpen,
  setCancelSurveyOpen,
  currentTier,
  handleAcceptPause,
  acceptingPause,
}: {
  pauseOfferOpen: boolean;
  setPauseOfferOpen: (open: boolean) => void;
  setCancelSurveyOpen: (open: boolean) => void;
  currentTier: string | null;
  handleAcceptPause: () => void;
  acceptingPause: boolean;
}) => {
  return (
    <Dialog open={pauseOfferOpen} onOpenChange={setPauseOfferOpen}>
      <DialogContent className="!gap-3">
        <DialogHero
          eyebrowClassName="inline-flex items-center gap-1.5"
          eyebrow={<><PauseCircle className="w-3 h-3" /> Take a breather</>}
          title="Pause 1 month free instead?"
          subtitle={`Keep your spot — request a one-month, no-charge pause on your ${currentTier ?? "plan"}. We'll confirm by email and your plan resumes after the pause. Cancel anytime if you've changed your mind.`}
        />
        <div
          className="rounded-ds-md p-3 mt-1 space-y-1"
          style={{
            background: "hsl(var(--gold-warm) / 0.10)",
            border: "0.5px solid hsl(var(--gold-warm) / 0.32)",
          }}
        >
          <p className="font-serif italic leading-snug" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.85)" }}>
            <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
              What you keep:
            </span>{" "}
            Your verification status, saved helpers, payout history, and reviews — all untouched. Once we confirm your pause by email, we'll send a heads-up a week before it ends.
          </p>
        </div>
        <DialogFooter className="!gap-2 sm:!justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              setPauseOfferOpen(false);
              setCancelSurveyOpen(true);
            }}
            className="rounded-ds-md"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Cancel instead
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setPauseOfferOpen(false)}
              className="rounded-ds-md"
            >
              Never mind
            </Button>
            <Button
              onClick={handleAcceptPause}
              disabled={acceptingPause}
              className="rounded-ds-md"
              style={{
                background: "hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                border: "1px solid hsl(var(--bark))",
                fontFamily: "Montserrat, system-ui, sans-serif",
                fontWeight: 600,
              }}
            >
              {acceptingPause ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Requesting</>
              ) : (
                <><PauseCircle className="w-4 h-4 mr-2" /> Request 1 month free</>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
