import { useState } from "react";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare } from "lucide-react";

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

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm(parseInt(hours), message.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHero eyebrow="Send a direct offer" title="Set a response deadline" />
        <div className="space-y-4">
          <p className="text-ds-11 text-muted-foreground">
            How long should <span className="font-medium text-foreground">{helperName}</span> have to accept or decline this job?
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
            <p className="text-ds-11 text-muted-foreground">
              If they don't respond in time, the job will be reopened automatically.
            </p>
          </div>

          {/* Optional message with offer */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-ds-13 font-medium text-foreground">
              <MessageSquare className="w-4 h-4" />
              Include a message <span className="text-muted-foreground font-normal">(optional)</span>
            </div>
            <Textarea
              aria-label="Message to helper (optional)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Say something to ${helperName}…`}
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="rounded-ds-sm bg-muted/50 border border-border p-3">
            <p className="text-ds-11 text-muted-foreground">
              <span className="font-medium text-foreground">⚠️ Denial policy:</span> Helprs who decline jobs repeatedly will face escalating consequences:
            </p>
            <ul className="text-ds-11 text-muted-foreground mt-1 space-y-0.5 list-disc pl-4">
              <li>1st & 2nd decline — no penalty</li>
              <li>3rd decline — warning issued</li>
              <li>4th decline — temporary ban</li>
              <li>5th+ decline — permanent ban</li>
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
