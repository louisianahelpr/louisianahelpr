import { useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { chipStyles } from "@/components/dashboard/JobFilters";
import { hapticError, hapticSuccess } from "@/lib/haptics";

const MINUTES = [10, 20, 30] as const;

/** The words the poster gets. One place, so the test and the sheet say the same thing. */
export function runningLateMessage(minutes: number): string {
  return `Running about ${minutes} minutes late. Sorry for the wait.`;
}

/**
 * Board 187: a one-tap "Running late" for the Helpr on the day: 10 / 20 / 30
 * minutes, and the poster gets a message in their chat with this job right
 * away (an ordinary message from the Helpr, the same row Messages sends, so
 * the chat's own safety rules apply). "Need a new time" hands over to the
 * existing date-change request instead. Names, never pronouns.
 */
export function RunningLateSheet({
  open,
  onOpenChange,
  jobId,
  posterId,
  posterName,
  userId,
  onNeedNewTime,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  posterId: string;
  /** The poster's name as the card has it ("" when unknown). */
  posterName: string;
  userId: string;
  /** Opens the existing "Ask for a new date or time" request; absent when a request is not allowed. */
  onNeedNewTime?: () => void;
}) {
  const [minutes, setMinutes] = useState<number>(10);
  const [sending, setSending] = useState(false);
  // By first name when the card has it; never he/she, never "the poster".
  const first = posterName.trim().split(/\s+/)[0] ?? "";
  const { chipBase, chipActive, chipIdle } = chipStyles;
  const send = async () => {
    setSending(true);
    try {
      unwrapMutation(
        await supabase
          .from("messages")
          .insert({ job_id: jobId, sender_id: userId, receiver_id: posterId, content: runningLateMessage(minutes), client_id: crypto.randomUUID() })
          .select("id"),
        { action: "tell them you're running late" },
      );
      hapticSuccess();
      toast(first ? `${first} knows you're about ${minutes} minutes late.` : `Sent: about ${minutes} minutes late.`);
      onOpenChange(false);
    } catch (err) {
      hapticError();
      toast.error(mutationErrorMessage(err, "That didn't send. Check your connection and try again."));
    } finally {
      setSending(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!sending) onOpenChange(o); }}>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }}
      >
        <SheetHero title="Running late?" />
        <div role="group" aria-label="How late" className="flex flex-wrap gap-2">
          {MINUTES.map((m) => (
            <button key={m} type="button" aria-pressed={minutes === m} className={`${chipBase} ${minutes === m ? chipActive : chipIdle}`} onClick={() => setMinutes(m)}>
              {m} min
            </button>
          ))}
          {onNeedNewTime && (
            <button type="button" className={`${chipBase} ${chipIdle}`} onClick={() => { onOpenChange(false); onNeedNewTime(); }}>
              Need a new time
            </button>
          )}
        </div>
        <p className="mt-3 text-ds-13 text-muted-foreground">{first || "They"} get{first ? "s" : ""} a message right away with your new arrival time.</p>
        <SheetFooter>
          <SheetPrimaryAction disabled={sending} onClick={() => void send()}>
            {sending ? "Sending…" : first ? `Tell ${first}` : "Send it"}
          </SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
