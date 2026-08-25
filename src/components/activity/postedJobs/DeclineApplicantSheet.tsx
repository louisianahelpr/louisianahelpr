import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { hapticLight } from "@/lib/haptics";
import { type EnrichedApplication } from "../activityConstants";

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
      <SheetContent
        side="bottom"
        className="pb-safe-nav p-5"
        style={{ background: "hsl(var(--parchment))" }}
      >
        {declineTarget && (() => {
          const targetName = formatName(declineTarget.profiles?.full_name, "this applicant");
          return (
            <div className="px-1 pt-1 pb-1 space-y-3.5">
              {/* Canonical sheet header. Was a hand-copied stack pinned at
                  1.1rem (one of four sheets that had each drifted to a different
                  title size); SheetHero is the single source of truth. */}
              <SheetHero title={`Decline ${targetName}?`} />

              {/* Quick-tap reason chips */}
              <div role="group" aria-label="Decline reason">
                <p
                  className="font-serif italic mb-2 text-ds-12"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Choose a reason (optional)
                </p>
                <div className="flex flex-wrap gap-2">
                  {DECLINE_REASONS.map((reason) => {
                    const active = declineReason === reason;
                    return (
                      <button
                        key={reason}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          hapticLight();
                          setDeclineReason(active ? null : reason);
                        }}
                        className="px-3 py-1.5 rounded-ds-md text-ds-12 font-sans font-semibold transition-all duration-150 active:scale-95"
                        style={{
                          // Third instance of the same defect (see 48ad36cd and
                          // ApplicantSortControls): a hardcoded white with no
                          // dark sibling, so the inactive chip painted 55% pure
                          // white onto a dark sheet. --ivory-sand is `0 0% 100%`
                          // in light mode, so light is unchanged.
                          background: active ? "hsl(var(--bark) / 0.10)" : "hsl(var(--ivory-sand) / 0.55)",
                          color: active ? "hsl(var(--bark))" : "hsl(var(--olivewood) / 0.8)",
                          border: active
                            ? "0.5px solid hsl(var(--bark) / 0.35)"
                            : "0.5px solid hsl(var(--olivewood) / 0.2)",
                          backdropFilter: "blur(8px)",
                          WebkitBackdropFilter: "blur(8px)",
                        }}
                      >
                        {reason}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Optional freetext note */}
              <div className="space-y-1">
                <label
                  htmlFor="decline-note"
                  className="font-serif italic uppercase block text-ds-10"
                  style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
                >
                  Add a note (optional)
                </label>
                <Textarea
                  id="decline-note"
                  value={declineNote}
                  onChange={(e) => setDeclineNote(e.target.value.slice(0, DECLINE_NOTE_MAX))}
                  maxLength={DECLINE_NOTE_MAX}
                  rows={2}
                  className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-serif italic text-ds-14 leading-relaxed resize-none"
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

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 rounded-ds-md"
                  disabled={declineSending}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 rounded-ds-md"
                  disabled={declineSending}
                  onClick={onConfirm}
                  style={{
                    background: "hsl(var(--olivewood))",
                    border: "1px solid hsl(var(--olivewood))",
                    color: "hsl(var(--parchment))",
                  }}
                >
                  {declineSending ? "Declining…" : "Confirm Decline"}
                </Button>
              </div>
            </div>
          );
        })()}
      </SheetContent>
    </Sheet>
  );
}
