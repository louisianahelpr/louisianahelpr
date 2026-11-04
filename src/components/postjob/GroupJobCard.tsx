import { Minus, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPriceExact } from "@/lib/format";
import { crewSmallestShare } from "@/components/postjob/crewSmallestShare";

/** The Group job card in Post a job's Logistics step: the crew size stepper and the per-Helpr split. Shown only
 *  while GROUP_JOBS_ENABLED and the job is a group job (the gate stays in LogisticsSection). */
export function GroupJobCard({
  helpersNeeded,
  setHelpersNeeded,
  budgetNum,
}: {
  helpersNeeded: string;
  setHelpersNeeded: (v: string) => void;
  budgetNum: number;
}) {
  // The crew stepper reads the field's number (2..10, the field's own min/max); a blank or odd value starts at 2.
  const crewCount = Number.parseInt(helpersNeeded, 10) || 2;
  return (
    <div className="rounded-ds-md border border-border p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-primary" />
        <span className="text-ds-13 font-semibold text-foreground">Group job</span>
      </div>
      <Label>How many Helprs needed?</Label>
      {/* Q2615 (Jobs audit 1102b row 29): the same - / + stepper as the budget one step earlier, around the
          exact field (it was a plain number field alone). */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="One fewer Helpr"
          disabled={crewCount <= 2}
          onClick={() => setHelpersNeeded(String(Math.max(2, crewCount - 1)))}
          className="w-11 shrink-0 rounded-full px-0"
        >
          <Minus className="h-5 w-5" aria-hidden />
        </Button>
        <Input
          type="number"
          inputMode="numeric"
          min="2"
          max="10"
          value={helpersNeeded}
          onChange={(e) => setHelpersNeeded(e.target.value)}
          className="w-16 text-center"
          aria-label="Number of Helprs needed"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="One more Helpr"
          disabled={crewCount >= 10}
          onClick={() => setHelpersNeeded(String(Math.min(10, Math.max(2, crewCount + 1))))}
          className="w-11 shrink-0 rounded-full px-0"
        >
          <Plus className="h-5 w-5" aria-hidden />
        </Button>
      </div>
      <p className="text-ds-11 text-muted-foreground">
        {/* The server's split (crew_slot_share_cents, largest remainder in
            cents): the smallest share, so no Helpr gets less than shown. */}
        Budget of ${formatPriceExact(budgetNum)} will be split: at least ${formatPriceExact(crewSmallestShare(budgetNum, parseInt(helpersNeeded) || 2))} per Helpr.
      </p>
      {/* A3-60: what a short crew means, from the server's rule (process-scheduled-payouts: every roster
          member is paid their share; refundUnfilledCrewShares returns the unfilled shares to the poster). */}
      <p data-crew-short="" className="text-ds-11 text-muted-foreground">
        If fewer Helprs sign up, the ones hired still do the job, and you get the unfilled shares back when they're paid.
      </p>
    </div>
  );
}
