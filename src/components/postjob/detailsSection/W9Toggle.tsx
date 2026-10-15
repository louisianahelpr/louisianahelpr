import { FileSignature } from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface W9ToggleProps {
  requiresW9: boolean;
  setRequiresW9: (next: boolean) => void;
}

/**
 * "Require a W-9 from the Helpr" — the poster's per-job opt-in (Q1680, owner
 * 2026-10-14: "should be asked if they want to choose it on post").
 *
 * It writes jobs.requires_w9, which nothing could set before (useJobSubmit
 * hard-coded false), and the Helpr hired for such a job is asked to sign the
 * W-9 when they accept (W9CollectionDialog, useOfferHandlers.afterAccepted).
 * Off by default. Shown to every account: everyone posts, so no role gate.
 * Same shape as PhotoProofToggle beside it.
 */
export function W9Toggle({ requiresW9, setRequiresW9 }: W9ToggleProps) {
  return (
    <div
      className={`rounded-ds-md border px-3 py-2.5 space-y-1 ${
        requiresW9 ? "border-primary/30 bg-primary/5" : "border-border"
      }`}
    >
      <div className="flex items-center gap-3">
        <label htmlFor="require-w9" className="flex items-center gap-2 cursor-pointer">
          <FileSignature className="w-4 h-4 text-primary shrink-0" />
          <span className="text-ds-13 font-semibold text-foreground">Require a W-9 From the Helpr</span>
        </label>
        <Switch id="require-w9" checked={requiresW9} onCheckedChange={setRequiresW9} />
      </div>
      <p className="text-ds-11 text-muted-foreground leading-snug max-w-prose">
        {requiresW9
          ? "The Helpr you hire signs a W-9 tax form in the app when they accept this job."
          : "Turn on if you need a W-9 tax form from the Helpr you hire, for example for business records."}
      </p>
    </div>
  );
}
