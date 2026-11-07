import { ReasonRow } from "@/components/ui/ReasonRow";
import { formatName } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHero,
  SheetPrimaryAction,
  SheetSecondaryAction,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { hapticLight } from "@/lib/haptics";
import { type EnrichedApplication } from "../../../components/job-card/activityConstants";

const DECLINE_NOTE_MAX = 200;
const DECLINE_REASONS = ["Found someone else", "Job is on hold", "Not the right fit"] as const;

interface DeclineApplicantSheetProps {
  declineTarget: EnrichedApplication | null;
  declineNote: string;
  setDeclineNote: (note: string) => void;
  declineReason: string | null;
  setDeclineReason: (reason: string | null) => void;
  declineSending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/** Decline confirmation sheet — collects an optional reason + note
    before calling onDeclineApplication. Keeps the UX low-friction:
    no note is required; the poster can just tap "Confirm decline". */
export function DeclineApplicantSheet({
  declineTarget,
  declineNote,
  setDeclineNote,
  declineReason,
  setDeclineReason,
  declineSending,
  onClose,
  onConfirm,
}: DeclineApplicantSheetProps) {
  return (
    <Sheet
      open={!!declineTarget}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {/* No `p-5`, no opaque `--parchment` background. `.glass-modal` is THE
          popup surface (0.95 alpha over a 40px blur) and this sheet was
          painting a fully opaque card over it, so it read as a different
          material from every dialog. The `pb-safe-nav` is also obsolete: this
          is a centred modal now, not a floor-anchored sheet. */}
      <SheetContent side="bottom">
        {declineTarget && (() => {
          const targetName = formatName(declineTarget.profiles?.full_name, "this applicant");
          return (
            <div className="space-y-3.5">
              {/* Canonical sheet header. Was a hand-copied stack pinned at
                  1.1rem (one of four sheets that had each drifted to a different
                  title size); SheetHero is the single source of truth. */}
              <SheetHero title={`Decline ${targetName}?`} />

              {/* Quick-tap reason chips */}
              <div role="group" aria-label="Decline reason">
                <p
                  className="font-sans mb-2 text-ds-12"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Choose a reason (optional)
                </p>
                {/* ONE COLUMN OF FULL-WIDTH ROWS — the app's single "pick a
                    reason" layout, shared with the report dialog and the
                    withdraw sheet. This was a `flex-wrap` chip rail, a third
                    vocabulary for the same job (the withdraw sheet used a
                    2-column grid, the report dialog a row list), and its
                    selected chip was a flat 10% bark tint — a flat selected
                    control, against the "selected controls are glossy" rule.
                    Selected rows now wear `btn-grad-primary` like every other
                    selected control in the app. */}
                <div className="space-y-1.5">
                  {DECLINE_REASONS.map((reason) => {
                    const active = declineReason === reason;
                    return (
                      <ReasonRow
                        key={reason}
                        pressed={active}
                        label={reason}
                        onClick={() => {
                          hapticLight();
                          setDeclineReason(active ? null : reason);
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Optional freetext note */}
              <div className="space-y-1">
                <label
                  htmlFor="decline-note"
                  className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground block"
                >
                  Add a note (optional)
                </label>
                <Textarea
                  id="decline-note"
                  value={declineNote}
                  onChange={(e) => setDeclineNote(e.target.value.slice(0, DECLINE_NOTE_MAX))}
                  maxLength={DECLINE_NOTE_MAX}
                  rows={2}
                  className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-sans text-ds-14 leading-relaxed resize-none"
                />
                <p
                  className="text-ds-11 text-right tabular-nums"
                  style={{
                    color: declineNote.length > DECLINE_NOTE_MAX - 20
                      ? "hsl(var(--burnt-sienna))"
                      : "hsl(var(--muted-foreground))",
                  }}
                >
                  {declineNote.length}/{DECLINE_NOTE_MAX}
                </p>
              </div>

              {/* THE SHARED POPUP FOOTER, not a hand-rolled `flex gap-2` row
                  of two `flex-1` buttons. And not a hand-written
                  `hsl(var(--olivewood))` fill either — that was a fourth
                  primary colour in the app. Declining an applicant is
                  reversible (the poster can invite someone else, or the same
                  person again), so it is the ordinary glossy primary. */}
              <SheetFooter>
                <SheetSecondaryAction disabled={declineSending} onClick={onClose}>
                  Cancel
                </SheetSecondaryAction>
                <SheetPrimaryAction disabled={declineSending} onClick={onConfirm}>
                  {declineSending ? "Declining…" : "Confirm decline"}
                </SheetPrimaryAction>
              </SheetFooter>
            </div>
          );
        })()}
      </SheetContent>
    </Sheet>
  );
}
