import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHero, DialogFooter, DialogPrimaryAction, DialogSecondaryAction } from "@/components/ui/dialog";
import { RadioCardList } from "@/components/ui/RadioCardList";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/currency-input";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { queryKeys } from "@/lib/queryKeys";
import { report } from "@/lib/errorLogger";
import { userFacingError } from "@/lib/userFacingError";
import { openRefundRequest, refundDollars, refundRushBackCents, type RefundScope } from "@/lib/refundRequests";
import { Money, RefundJobSummary, firstNameOf } from "./refundParts";

/** The shortest "what happened" the server takes (refund_request_needs_reason). */
const REASON_MIN = 15;

/**
 * Board 141, poster side: "Ask for a refund". Part of it (an amount, at least
 * $1 and less than the price) or all of it, and what happened. The server
 * checks the amount against the job's own price and uses the whole price for
 * All of it; nothing moves until the Helpr agrees.
 */
export function RefundRequestDialog({
  open,
  onOpenChange,
  job,
  helperName,
  userId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** urgent_fee: the rush fee, whose same share a part refund also returns (owner 2026-10-21). */
  job: { id: string; title: string; budget: number | null; urgent_fee?: number | null; date_needed?: string | null };
  /** The Helpr, "First L.". */
  helperName: string;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"" | RefundScope>("");
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [reasonFlagged, setReasonFlagged] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const priceCents = Math.round((job.budget ?? 0) * 100);
  const amountCents = scope === "all" ? priceCents : Math.round((amount ?? 0) * 100);
  const amountOk = scope === "all" || (scope === "part" && amountCents >= 100 && amountCents < priceCents);
  const reasonOk = reason.trim().length >= REASON_MIN;
  // Owner 2026-10-21: a part refund also returns the same share of the rush fee.
  const rushBackCents = scope === "part" && amountOk ? refundRushBackCents(job, { amount_cents: amountCents, budget_cents: priceCents }) : 0;
  const first = firstNameOf(helperName);

  const close = () => {
    if (!sending) onOpenChange(false);
  };

  const send = async () => {
    if (sendingRef.current || !scope || !amountOk || !reasonOk) return;
    sendingRef.current = true;
    setSending(true);
    try {
      // For All of it the library sends no amount at all (the server uses the price).
      await openRefundRequest(job.id, scope, amountCents, reason.trim());
      hapticSuccess();
      toast(`Sent to ${first}. Nothing moves unless they agree.`);
      // The card's state is the request itself; the job lists may show it too.
      try {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["refund-request", job.id] }),
          queryClient.invalidateQueries({ queryKey: queryKeys.activity.posted(userId) }),
        ]);
      } catch (refreshErr) {
        // The request IS sent; a stale card is recoverable, a false failure is not.
        report(refreshErr, { tags: { source: "RefundRequestDialog.refresh" }, context: { jobId: job.id } });
      }
      onOpenChange(false);
    } catch (err) {
      hapticError();
      toast.error(userFacingError(err, "We couldn't send that. Check your connection and try again."));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero title="Ask for a refund" />
        <div className="space-y-3.5">
          <RefundJobSummary title={job.title} who={helperName} dateNeeded={job.date_needed} priceCents={priceCents} />

          <RadioCardList
            required
            label="How much do you want back?"
            options={[
              { value: "part", label: "Part of it", sub: "The job is partly done" },
              { value: "all", label: "All of it", sub: "They didn't do the job" },
            ]}
            value={scope}
            onChange={(v) => setScope(v as RefundScope)}
          />

          {scope === "part" && (
            <div className="space-y-1.5">
              <Label htmlFor="refund-amount" className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
                How much back?
              </Label>
              <div className="flex items-center gap-2">
                <CurrencyInput
                  id="refund-amount"
                  value={amount}
                  onChange={setAmount}
                  min={1}
                  max={Math.max(1, priceCents / 100 - 0.01)}
                  placeholder="e.g. 20.00"
                  aria-describedby="refund-amount-of"
                  className="max-w-[10rem] rounded-[14px] font-semibold text-[hsl(var(--burnt-sienna))]"
                />
                <span id="refund-amount-of" className="font-sans text-ds-14 text-muted-foreground">
                  of <Money cents={priceCents} />
                </span>
              </div>
              {amount !== undefined && !amountOk && (
                <p className="font-sans text-ds-12" style={{ color: "hsl(var(--alert-ink))" }}>
                  Ask for at least $1 and less than {refundDollars(priceCents)}, or pick All of it.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="refund-reason" className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
              What happened
            </Label>
            <Textarea
              id="refund-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => { if (reason.trim().length > 0) setReasonFlagged(true); }}
              placeholder="e.g. Two shelves are still missing their back panel."
              rows={3}
              maxLength={1000}
              aria-required="true"
              aria-describedby="refund-reason-hint"
              className="rounded-[14px] bg-card border-border font-sans text-ds-14 leading-relaxed"
            />
            {!reasonOk && reasonFlagged && (
              <p id="refund-reason-hint" className="font-sans text-ds-12" style={{ color: "hsl(var(--alert-ink))" }}>
                Tell them what happened in a sentence or two.
              </p>
            )}
          </div>

          <p className="font-sans text-ds-12 leading-relaxed text-muted-foreground">
            {first} can agree, offer to come back and finish, or say no and let Helpr decide.
            {scope === "all"
              ? ` If ${first} agrees, most of what you paid goes back to how you paid. Your receipt shows the exact amount.`
              : rushBackCents > 0
                ? ` If ${first} agrees, the amount you ask for goes back to how you paid, with the same share of the rush fee (${refundDollars(rushBackCents)}): ${refundDollars(amountCents + rushBackCents)} in all.`
                : ` If ${first} agrees, exactly the amount you ask for goes back to how you paid.`}
          </p>
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={close} disabled={sending}>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction onClick={send} disabled={sending || !scope || !amountOk || !reasonOk}>
            {sending ? "Sending…" : `Send to ${first}`}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
