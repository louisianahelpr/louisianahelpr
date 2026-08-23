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
      <SheetContent
        side="bottom"
        className="pb-[calc(1rem_+_env(safe-area-inset-bottom,0px))]"
      >
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
            Create free account
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
            I already have an account
          </Button>
          <button
            onClick={() => onOpenChange(false)}
            className="text-ds-11 text-muted-foreground py-2 hover:text-foreground transition-colors"
          >
            Keep browsing
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
};
