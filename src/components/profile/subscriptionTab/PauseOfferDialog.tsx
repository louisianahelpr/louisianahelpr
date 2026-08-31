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
  handleAcceptPause,
  acceptingPause,
}: {
  pauseOfferOpen: boolean;
  setPauseOfferOpen: (open: boolean) => void;
  setCancelSurveyOpen: (open: boolean) => void;
  handleAcceptPause: () => void;
  acceptingPause: boolean;
}) => {
  return (
    <Dialog open={pauseOfferOpen} onOpenChange={setPauseOfferOpen}>
      <DialogContent>
        <DialogHero
          title="Pause 1 Month Free Instead?"
        />
        <div
          className="rounded-ds-md p-3 mt-1 space-y-1"
          style={{
            background: "hsl(var(--amber-tint) / 0.10)",
            border: "0.5px solid hsl(var(--amber-tint) / 0.32)",
          }}
        >
          <p className="font-serif italic leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
            <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
              What you keep:
            </span>{" "}
            Your verification status, Saved Helprs, payout history, and reviews — all untouched. We’ll follow up by email to confirm your pause.
          </p>
        </div>
        <DialogFooter className="flex-col sm:flex-row sm:!justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setPauseOfferOpen(false);
              setCancelSurveyOpen(true);
            }}
            className="rounded-ds-md w-full sm:w-auto"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Cancel Instead
          </Button>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              onClick={() => setPauseOfferOpen(false)}
              className="rounded-ds-md w-full sm:w-auto"
            >
              Never Mind
            </Button>
            <Button
              onClick={handleAcceptPause}
              disabled={acceptingPause}
              className="rounded-ds-md w-full sm:w-auto"
              style={{
                background: "hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                border: "1px solid hsl(var(--bark))",
              }}
            >
              {acceptingPause ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Requesting</>
              ) : (
                <><PauseCircle className="w-4 h-4 mr-2" /> Request 1 Month Free</>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
