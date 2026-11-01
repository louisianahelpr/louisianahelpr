import { Textarea } from "@/components/ui/textarea";
import { HELPR_FAULT_CONFIRM_COPY, NO_HELPR_COPY, type HelprFaultKind } from "./helprFault";

interface HelprFaultFieldsProps {
  helperId: string | null;
  helperName?: string | null;
  loading: boolean;
  kind: HelprFaultKind;
  note: string;
  onKindChange: (kind: HelprFaultKind) => void;
  onNoteChange: (note: string) => void;
}

/**
 * Q2082 (b): the "Helpr at fault" form shared by the admin jobs refund dialog
 * and the dispute card. Who (found for the admin, never typed), what happened,
 * and a note for the audit log. With no Helpr to rule against it says so and
 * offers nothing to fill in.
 */
export const HelprFaultFields = ({
  helperId,
  helperName,
  loading,
  kind,
  note,
  onKindChange,
  onNoteChange,
}: HelprFaultFieldsProps) => {
  if (loading) {
    return <p className="text-ds-11 text-muted-foreground">Finding the Helpr on this job…</p>;
  }
  if (!helperId) {
    return <p className="text-ds-11 text-[hsl(var(--destructive-ink))]" role="status">{NO_HELPR_COPY}</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-ds-11 text-foreground">
        Helpr: <span className="font-medium">{helperName || "the Helpr booked on this job"}</span>
      </p>
      <fieldset className="flex gap-4">
        <legend className="sr-only">What happened</legend>
        <label className="flex min-h-11 items-center gap-1.5 text-ds-13">
          <input type="radio" className="h-4 w-4 min-h-0 min-w-0 shrink-0" style={{ accentColor: "hsl(var(--primary))" }} name="helpr-fault-kind" value="no_show" checked={kind === "no_show"} onChange={() => onKindChange("no_show")} />
          No-show
        </label>
        <label className="flex min-h-11 items-center gap-1.5 text-ds-13">
          <input type="radio" className="h-4 w-4 min-h-0 min-w-0 shrink-0" style={{ accentColor: "hsl(var(--primary))" }} name="helpr-fault-kind" value="backout" checked={kind === "backout"} onChange={() => onKindChange("backout")} />
          Backed out
        </label>
      </fieldset>
      <Textarea
        aria-label="Helpr at fault note"
        placeholder="What the poster reported and what you checked (required, kept in the audit log)"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        rows={2}
      />
      <p className="text-ds-11 text-muted-foreground">{HELPR_FAULT_CONFIRM_COPY}</p>
    </div>
  );
};
