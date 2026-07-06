import { Button } from "@/components/ui/button";
import { X, UserCheck } from "lucide-react";

interface DirectOfferBannerProps {
  offerToHelperName: string;
  onCancel: () => void;
}

/**
 * Shown when the poster arrives via /post-job?offerTo=<helperId> — the
 * task is pre-targeted to a saved helpr who gets a 24h head start.
 */
export function DirectOfferBanner({ offerToHelperName, onCancel }: DirectOfferBannerProps) {
  return (
    <div className="rounded-ds-md border-2 border-primary/40 bg-primary/5 p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
        <UserCheck className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0 break-words">
        <p className="text-ds-13 font-semibold text-foreground">
          Direct offer to {offerToHelperName || "your saved Helpr"}
        </p>
        <p className="text-ds-11 text-muted-foreground">
          They'll have 24 hours to accept before this job opens to all Helprs.
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onCancel}
        className="rounded-ds-md h-10 w-10 shrink-0"
        aria-label="Cancel direct offer"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
