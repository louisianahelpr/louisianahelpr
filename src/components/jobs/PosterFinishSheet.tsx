import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { formatPriceExact } from "@/lib/format";
import { endSentence } from "@/lib/utils";
import { POSTER_FINISH_LABEL } from "../../../supabase/functions/_shared/posterFinish";
import { STANDARD_PAYOUT_PHRASE } from "../../../supabase/functions/_shared/escrowTiming";

/**
 * THE POSTER'S "MARK DONE AND RELEASE" CONFIRM (owner 11-10, her job "Mow and Weed Eat" 7b1da54b: the continue day
 * passed with no done from the Helpr and the poster had no way to pay). One tap past this releases the money in full
 * (create-payment 'release' with posterFinishes, the poster's Approve with the Helpr's half counted as done), so the
 * sheet says the amount, who it goes to, when, and that it can't be undone. The amount is the approve sheet's own
 * rule: the job price when it is the whole release (a one-Helpr job with no rush fee), else no number. Display only.
 * Not finished? The sheet points at "Didn't come back" (owner 11-08), the admin-decided path, when one is offered.
 * Guard: src/pages/jobs/jobPage/JobPage.test.tsx ("Yusef's job: the set day passed").
 */
export function PosterFinishSheet({
  open,
  onOpenChange,
  jobTitle,
  helperFirst,
  jobPrice,
  onContinueDay,
  missedOffered,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobTitle: string;
  helperFirst: string | null;
  /** The job price this releases (the whole release), or null to name no number. */
  jobPrice: number | null;
  /** A continue day is open: the confirm says it ends. */
  onContinueDay: boolean;
  /** "Didn't come back" is offered on the page: the sheet names it for unfinished work. */
  missedOffered: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  const who = (helperFirst ?? "").trim() || "your Helpr";
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <SheetContent side="bottom" data-poster-finish-sheet="">
        <SheetHero title={`${POSTER_FINISH_LABEL}?`} />
        <div className="space-y-2 text-ds-14 leading-relaxed">
          <p data-poster-finish-amount="">
            {jobPrice ? (
              <>The <strong className="tabular-nums" style={{ color: "hsl(var(--sienna-ink))" }}>${formatPriceExact(jobPrice)}</strong> job price for "{jobTitle}" is released to {endSentence(who)}</>
            ) : (
              <>Your payment for "{jobTitle}" is released to {endSentence(who)}</>
            )}{" "}
            Their pay goes out {STANDARD_PAYOUT_PHRASE}.
          </p>
          <p className="text-muted-foreground">
            {onContinueDay ? "This marks the job done and ends the continue day. " : "This marks the job done. "}
            You can't undo it.
          </p>
          {missedOffered && (
            <p className="text-muted-foreground">Work not finished? Use "Didn't come back" in More options instead, and our team decides the payment.</p>
          )}
        </div>
        <SheetFooter>
          <SheetSecondaryAction disabled={busy} onClick={() => onOpenChange(false)}>Not now</SheetSecondaryAction>
          <SheetPrimaryAction disabled={busy} onClick={onConfirm}>
            {busy ? "Releasing…" : jobPrice ? `${POSTER_FINISH_LABEL} $${formatPriceExact(jobPrice)}` : POSTER_FINISH_LABEL}
          </SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
