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
import { lazy, Suspense, useState } from "react";
import { useInRouterContext, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { ErrorState } from "@/components/ui/ErrorState";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchMyOrderTalks, fetchOrderTalk, MY_ORDER_TALKS_KEY, sendOrderMessage } from "@/lib/declutter/orderTalk";
import { talkTime } from "@/lib/declutter/talkTime";
import { focusSheetItself } from "./focusSheetItself";

// A3-27: the order card's step line, loaded only with the chat (it reads the cards' queries).
const OrderTalkStep = lazy(() => import("./OrderTalkStep"));

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
  // AUD31-13: the sheet names the item it is about, from the same list Messages -> Declutter reads (one cached read).
  const talks = useQuery({ queryKey: MY_ORDER_TALKS_KEY, queryFn: fetchMyOrderTalks });
  const itemTitle = talks.data?.find((r) => r.order_id === orderId)?.title ?? null;
  const [draft, setDraft] = useState("");
  // AUD31-11: a refused message is said under the box, as Questions does, never in a toast over the box and draft.
  const [refusal, setRefusal] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => sendOrderMessage(orderId, draft.trim()),
    // Messages -> Declutter's list (DeclutterOrderTalkInbox) shows who sent the last message: refresh it too.
    onSuccess: () => { setDraft(""); setRefusal(null); void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: MY_ORDER_TALKS_KEY }); },
    onError: (err) => setRefusal(declutterErrorMessage(err)),
  });
  const t = talk.data;
  const other = t?.side === "seller" ? "buyer" : "seller";
  const open = !!t?.open;
  // AUD31-31: an ended chat is not titled as if it could still be sent to, and says when and why it ended.
  const endedAt = !open && t?.open_until && new Date(t.open_until).getTime() <= Date.now() ? t.open_until : null;
  const formId = `order-talk-form-${orderId}`;
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor={!webDesktop} onOpenAutoFocus={focusSheetItself}
        className={`bg-premium-page max-h-[90dvh] overflow-y-auto ${webDesktop ? "sm:max-w-[520px]" : ""}`} data-order-talk="">
        <SheetHero title={!t ? "Order chat" : open ? `Message the ${other}` : `Your chat with the ${other}`} />
        {itemTitle && <p className="mt-1 truncate text-ds-14 text-muted-foreground" data-order-talk-item="">About &ldquo;{itemTitle}&rdquo;</p>}
        {talk.isError ? (
          <ErrorState variant="inline" title="We couldn't load this chat." body={declutterErrorMessage(talk.error)} onRetry={() => void talk.refetch()} />
        ) : talk.isPending || !t ? (
          <p className="mt-2 text-ds-14 text-muted-foreground">Loading…</p>
        ) : (
          <div className="mt-2 space-y-3">
            {/* A3-27 (audit 11-01): the same next step the order card shows, with its one button. */}
            {(t.side === "buyer" || t.side === "seller") && <Suspense fallback={null}><OrderTalkStep orderId={orderId} side={t.side} /></Suspense>}
            <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }}>
              Only you and the {other} can read this. Keep phone numbers, emails and payment out of the chat.
              {open && t.open_until ? ` It's open until ${when(t.open_until)}.` : ""}
            </p>
            {!open && (
              <p className="rounded-xl border border-border bg-card px-3 py-2 text-ds-13 text-foreground" data-order-talk-ended="">
                {endedAt ? `This chat ended ${when(endedAt)}, 48 hours after the handover.` : "This chat has ended."} You can still read it.
                {" "}For a problem with this order, use Report a problem on its card.
              </p>
            )}
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
                  maxLength={1000} value={draft} onChange={(e) => { setDraft(e.target.value); setRefusal(null); }}
                  aria-invalid={refusal ? true : undefined} aria-describedby={refusal ? `order-talk-refusal-${orderId}` : undefined} />
                {refusal && <p id={`order-talk-refusal-${orderId}`} role="alert" className="text-ds-13 text-destructive-ink" data-order-talk-refusal="">{refusal}</p>}
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
