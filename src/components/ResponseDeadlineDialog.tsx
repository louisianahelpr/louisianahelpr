import { useState } from "react";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { RELIABILITY_LADDER_RUNGS } from "@/lib/reliabilityLadder";

type Props = {
  open: boolean;
  helperName: string;
  onConfirm: (deadlineHours: number, message?: string) => Promise<void> | void;
  onClose: () => void;
};

const deadlineOptions = [
  { value: "1", label: "1 hour" },
  { value: "2", label: "2 hours" },
  { value: "4", label: "4 hours" },
  { value: "8", label: "8 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
  { value: "48", label: "48 hours" },
];

export const ResponseDeadlineDialog = ({ open, helperName, onConfirm, onClose }: Props) => {
  const [hours, setHours] = useState("24");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selectedLabel =
    deadlineOptions.find((o) => o.value === hours)?.label ?? `${hours} hours`;

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm(parseInt(hours), message.trim() || undefined);
    } catch {
      // The confirm callback surfaces its own specific errors when it can;
      // this catch is the backstop so a thrown failure never dies silently
      // with the dialog stuck open and no explanation.
      toast.error("Couldn't send the offer — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHero eyebrow="Send a direct offer" title="Set a Response Deadline" />
        <div className="space-y-4">
          {/* Lede in the same serif-italic olivewood every other money/offer
              dialog opens with (TipDialog, InstantPayoutDialog). This dialog
              was the one all-grayscale member of that set. */}
          <p className="font-serif italic leading-relaxed text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
            How long should <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>{helperName}</span> have to accept or decline this job?
          </p>
          <div className="space-y-2">
            <Select value={hours} onValueChange={setHours}>
              <SelectTrigger aria-label="Response deadline">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {deadlineOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Says the window back to you the way JobBoostDialog says
                "runs for 24 hours" — the choice you just made, in display type,
                rather than a grey "in time". */}
            <p className="font-serif italic text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              If they don't respond within{" "}
              <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>{selectedLabel}</span>
              , the job will be reopened automatically.
            </p>
          </div>

          {/* Optional message with offer */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-ds-13 font-medium text-foreground">
              <MessageSquare className="w-4 h-4" />
              Include a message <span className="text-muted-foreground font-normal">(optional)</span>
            </div>
            <Textarea
              aria-label="Message to Helpr (optional)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Say something to ${helperName}…`}
              rows={3}
              className="resize-none"
            />
          </div>

          {/* The one notice block, painted the way InstantPayoutDialog paints
              its notice: a burnt-sienna wash and hairline, not `bg-muted/50`.
              The icon is the lucide stroke glyph the rest of the app uses —
              this was the last raw ⚠️ emoji standing in for one. */}
          <div
            className="rounded-ds-sm p-3"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.08)",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
            }}
          >
            <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              <span
                className="inline-flex items-center gap-1.5 font-semibold align-[-2px]"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              >
                <TriangleAlert aria-hidden className="w-3.5 h-3.5 shrink-0" />
                Denial policy:
              </span>{" "}
              Helprs who decline jobs repeatedly will face escalating consequences:
            </p>
            {/* Rungs come from the shared ladder statement so this list can
                never again disagree with what the RPC actually applies —
                it did (every rung here was off by one). */}
            <ul className="text-ds-11 mt-1 space-y-0.5 list-disc pl-4" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              {RELIABILITY_LADDER_RUNGS.map((rung) => (
                <li key={rung}>{rung}</li>
              ))}
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? "Sending…" : "Send Offer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
