import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, UserCheck } from "lucide-react";
import { OFFER_RESPONSE_WINDOWS, offerWindowLabel } from "@/lib/offerResponseWindow";

interface DirectOfferBannerProps {
  offerToHelperName: string;
  onCancel: () => void;
  /** Hours the offer is held for this helpr before the job opens to everyone. */
  responseHours: number;
  onResponseHoursChange: (hours: number) => void;
}

/**
 * Shown when the poster arrives via /post-job?offerTo=<helperId> — the
 * task is pre-targeted to a saved helpr who gets a head start.
 *
 * The length of that head start is the poster's call. It used to be hardcoded
 * to 24 hours (in jobSubmitHelpers) with this banner simply asserting "24
 * hours" as a fact — even though the accept-an-application flow has offered a
 * 1/2/4/8/12/24/48h picker all along, and `auto-expire-jobs` documents the
 * direct-offer window as poster-chosen too. A same-day job routed to one
 * person for a full day before anyone else can see it is the case that made
 * this matter.
 */
export function DirectOfferBanner({
  offerToHelperName,
  onCancel,
  responseHours,
  onResponseHoursChange,
}: DirectOfferBannerProps) {
  const name = offerToHelperName || "your saved Helpr";
  return (
    <div className="rounded-ds-md border-2 border-primary/40 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <UserCheck className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0 break-words">
          <p className="text-ds-13 font-semibold text-foreground">
            Direct offer to {name}
          </p>
          <p className="text-ds-11 text-muted-foreground">
            They'll have {offerWindowLabel(responseHours)} to accept before this job
            opens to all Helprs.
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

      <div className="flex items-center gap-3">
        <Label
          htmlFor="direct-offer-window"
          className="text-ds-11 text-muted-foreground shrink-0"
        >
          First look for
        </Label>
        <Select
          value={String(responseHours)}
          onValueChange={(v) => onResponseHoursChange(parseInt(v, 10))}
        >
          <SelectTrigger id="direct-offer-window" className="h-10 flex-1 min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OFFER_RESPONSE_WINDOWS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
