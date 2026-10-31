/**
 * The delivery chat (BUY-36): "Message about this delivery" on the Helpr's, buyer's and seller's delivery cards, over the
 * page. Same sheet as the paid-order chat (DeclutterOrderTalk). An ended chat keeps its history and loses the box.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { ErrorState } from "@/components/ui/ErrorState";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchDeliveryTalk, sendDeliveryMessage, type TalkSide } from "@/lib/helprTasks/talk";
import { focusSheetItself } from "./focusSheetItself";

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
const WHO: Record<TalkSide, string> = { helpr: "The Helpr", buyer: "The buyer", seller: "The seller" };

export function DeliveryTalkButton({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" className="rounded-full" onClick={() => setOpen(true)}>Message about this delivery</Button>
      {open && <DeliveryTalkSheet taskId={taskId} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeliveryTalkSheet({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const webDesktop = useIsWebDesktop();
  const qc = useQueryClient();
  const key = ["declutter", "delivery-talk", taskId] as const;
  const talk = useQuery({ queryKey: key, queryFn: () => fetchDeliveryTalk(taskId), refetchInterval: 15_000 });
  const [draft, setDraft] = useState("");
  const send = useMutation({
    mutationFn: () => sendDeliveryMessage(taskId, draft.trim()),
    onSuccess: () => { setDraft(""); void qc.invalidateQueries({ queryKey: key }); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const t = talk.data;
  const formId = `delivery-talk-form-${taskId}`;
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor={!webDesktop} onOpenAutoFocus={focusSheetItself}
        className={`bg-premium-page max-h-[90dvh] overflow-y-auto ${webDesktop ? "sm:max-w-[520px]" : ""}`} data-delivery-talk="">
        <SheetHero title="Message about this delivery" />
        {talk.isError ? (
          <ErrorState variant="inline" title="We couldn't load this chat." body={declutterErrorMessage(talk.error)} onRetry={() => void talk.refetch()} />
        ) : talk.isPending || !t ? (
          <p className="mt-2 text-ds-14 text-muted-foreground">Loading…</p>
        ) : (
          <div className="mt-2 space-y-3">
            <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }}>
              The Helpr, the buyer and the seller can all read this. Keep phone numbers, emails and payment out of the chat.
              {!t.open ? " This chat has ended." : ""}
            </p>
            <ol className="space-y-2" aria-label="Messages">
              {t.messages.length === 0 && <li className="text-ds-13 text-muted-foreground">No messages yet.</li>}
              {t.messages.map((m) => (
                <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${m.mine ? "bg-[hsl(var(--bark)/0.1)]" : "border border-border bg-card"}`}>
                    <p className="text-ds-12 font-semibold text-muted-foreground">{m.mine ? "You" : WHO[m.side]} · {when(m.created_at)}</p>
                    <p className="whitespace-pre-wrap break-words text-ds-14 text-foreground">{m.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            {t.open && (
              <form id={formId} className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send.mutate(); }}>
                <label htmlFor={`delivery-talk-${taskId}`} className="block text-ds-13 font-medium">Message</label>
                <textarea id={`delivery-talk-${taskId}`} className="min-h-20 w-full rounded-xl border border-input bg-background px-3 py-2 text-ds-14"
                  maxLength={1000} value={draft} onChange={(e) => setDraft(e.target.value)} />
              </form>
            )}
          </div>
        )}
        <SheetFooter className="mt-4">
          <SheetSecondaryAction onClick={onClose}>Close</SheetSecondaryAction>
          {t?.open && (
            <SheetPrimaryAction type="submit" form={formId} disabled={send.isPending || draft.trim().length === 0}>
              {send.isPending ? "Sending…" : "Send"}
            </SheetPrimaryAction>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
