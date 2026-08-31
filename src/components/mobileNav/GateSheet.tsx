import { useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHero,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface GateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Guest "tease & convert" sheet — opens when a signed-out user taps a
 * locked tab or the Post FAB. Extracted verbatim from MobileNav; copy,
 * classNames, and navigation targets are unchanged.
 */
export const GateSheet = ({ open, onOpenChange }: GateSheetProps) => {
  const navigate = useNavigate();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Hug the content: the sheet has no fixed height, so it already sizes
          to fit — but the shared bottom-sheet base padding (1.5rem) stacked
          on the iOS home-indicator inset leaves a dead band below the thin
          "Keep browsing" link. Trim the bottom padding to a single 1rem over
          the safe-area inset so the sheet's edge sits just under that link. */}
      {/* No bespoke padding. `side="bottom"` stopped being a floor-anchored
            sheet — it is a centred modal at every width now — so the
            safe-area bottom inset it used to need is dead weight, and each
            sheet had written a different one (`pb-safe-nav`,
            `pb-[calc(var(--safe-area-bottom)+1rem)]`, `pb-[max(1.25rem,…)]`,
            `pt-6 px-5`, `pt-3 px-4`). The shared `p-4 sm:p-5` on
            SheetContent is the same padding ramp DialogContent uses. */}
          <SheetContent side="bottom">
        <SheetHero title="Create Your Free Account" />
        <div className="flex flex-col gap-3 mt-6">
          <Button
            size="lg"
            className="w-full"
            onClick={() => {
              onOpenChange(false);
              navigate("/signup");
            }}
          >
            Create Free Account
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            onClick={() => {
              onOpenChange(false);
              navigate("/login");
            }}
          >
            I Already Have an Account
          </Button>
          <button
            onClick={() => onOpenChange(false)}
            className="text-ds-11 text-muted-foreground py-2 hover:text-foreground transition-colors"
          >
            Keep Browsing
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
};
