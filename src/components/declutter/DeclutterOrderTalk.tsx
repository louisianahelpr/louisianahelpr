/**
 * The order chat on a PAID Declutter order (audit 1028 part 2, D2-1; migration 20261030004216_declutter_order_talk).
 * Before: once an order was paid, the buyer and seller had no way to reach each other, yet the refund notices and
 * panel told them to "arrange it in Messages". Now each paid order card has "Message the seller" / "Message the
 * buyer", which opens this chat over the page (?order_talk=<order id>, the link its notices carry too).
 *
 * The server is the protection (declutter_order_talk_view / declutter_send_order_message): only the order's two sides
 * read or write it, the contact-leak filter and the block check run there, and it closes 48 hours after the handover
 * (held open while a problem or refund request is open). An ended chat keeps its history and loses the box.
 * Its own module: DeclutterHandoverViews is at the component-size limit.
 */
import { useState } from "react";
import { useInRouterContext, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { ErrorState } from "@/components/ui/ErrorState";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchOrderTalk, MY_ORDER_TALKS_KEY, sendOrderMessage } from "@/lib/declutter/orderTalk";
import { talkTime } from "@/lib/declutter/talkTime";
import { focusSheetItself } from "./focusSheetItself";

// AUD31-12: the weekday alone only within 6 days; older lines carry their date.
const when = (iso: string) => talkTime(iso);

/** "Message the seller" / "Message the buyer" on a paid order card: puts ?order_talk=<order id> on the address. */
export function OrderTalkButton(props: { orderId: string; side: "buyer" | "seller" }) {
  // The app always renders cards inside the router; a card rendered alone (unit tests of other card parts) has none.
  return useInRouterContext() ? <OrderTalkLinkButton {...props} /> : null;
}

function OrderTalkLinkButton({ orderId, side }: { orderId: string; side: "buyer" | "seller" }) {
  const [params, setParams] = useSearchParams();
  const open = () => {
    const next = new URLSearchParams(params);
    next.set("order_talk", orderId);
    setParams(next);
  };
  return (
    <Button type="button" variant="outline" className="rounded-full" onClick={open}>
      {side === "buyer" ? "Message the seller" : "Message the buyer"}
    </Button>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The chat for ?order_talk=<order id>; closing it takes the parameter off. */
export function OrderTalkFromLink() {
  const [params, setParams] = useSearchParams();
  const orderId = params.get("order_talk");
  if (!orderId || !UUID.test(orderId)) return null;
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("order_talk");
    setParams(next, { replace: true });
  };
  return <OrderTalkSheet orderId={orderId} onClose={close} />;
}

function OrderTalkSheet({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const webDesktop = useIsWebDesktop();
  const qc = useQueryClient();
  const key = ["declutter", "order-talk", orderId] as const;
  // A light poll while the chat is open (the other side's new message shows within 15 seconds).
  const talk = useQuery({ queryKey: key, queryFn: () => fetchOrderTalk(orderId), refetchInterval: 15_000 });
  const [draft, setDraft] = useState("");
  const send = useMutation({
    mutationFn: () => sendOrderMessage(orderId, draft.trim()),
    // Messages -> Declutter's list (DeclutterOrderTalkInbox) shows who sent the last message: refresh it too.
    onSuccess: () => { setDraft(""); void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: MY_ORDER_TALKS_KEY }); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const t = talk.data;
  const other = t?.side === "seller" ? "buyer" : "seller";
  const open = !!t?.open;
  const formId = `order-talk-form-${orderId}`;
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor={!webDesktop} onOpenAutoFocus={focusSheetItself}
        className={`bg-premium-page max-h-[90dvh] overflow-y-auto ${webDesktop ? "sm:max-w-[520px]" : ""}`} data-order-talk="">
        <SheetHero title={t ? `Message the ${other}` : "Order chat"} />
        {talk.isError ? (
          <ErrorState variant="inline" title="We couldn't load this chat." body={declutterErrorMessage(talk.error)} onRetry={() => void talk.refetch()} />
        ) : talk.isPending || !t ? (
          <p className="mt-2 text-ds-14 text-muted-foreground">Loading…</p>
        ) : (
          <div className="mt-2 space-y-3">
            <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }}>
              Only you and the {other} can read this. Keep phone numbers, emails and payment out of the chat.
              {!open ? " This chat has ended." : t.open_until ? ` It's open until ${when(t.open_until)}.` : ""}
            </p>
            <ol className="space-y-2" aria-label="Messages">
              {t.messages.length === 0 && <li className="text-ds-13 text-muted-foreground">No messages yet.</li>}
              {t.messages.map((m) => (
                <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${m.mine ? "bg-[hsl(var(--bark)/0.1)]" : "border border-border bg-card"}`}>
                    <p className="text-ds-12 font-semibold text-muted-foreground">{m.mine ? "You" : `The ${other}`} · {when(m.created_at)}</p>
                    <p className="whitespace-pre-wrap break-words text-ds-14 text-foreground">{m.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            {open && (
              <form id={formId} className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send.mutate(); }}>
                <label htmlFor={`order-talk-${orderId}`} className="block text-ds-13 font-medium">Message</label>
                <textarea id={`order-talk-${orderId}`} className="min-h-20 w-full rounded-xl border border-input bg-background px-3 py-2 text-ds-14"
                  maxLength={1000} value={draft} onChange={(e) => setDraft(e.target.value)} />
              </form>
            )}
          </div>
        )}
        {/* The shared popup footer: Close, and Send while the chat is open (it submits the form above). */}
        <SheetFooter className="mt-4">
          <SheetSecondaryAction onClick={onClose}>Close</SheetSecondaryAction>
          {open && (
            <SheetPrimaryAction type="submit" form={formId} disabled={send.isPending || draft.trim().length === 0}>
              {send.isPending ? "Sending…" : "Send"}
            </SheetPrimaryAction>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
