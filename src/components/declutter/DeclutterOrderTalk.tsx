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
import { Link, useInRouterContext, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { SendHorizontal } from "lucide-react";
import { chatBubbleShape, chatBubbleStyle } from "@/components/messages/chatView/chatBubbleLook";
import { ErrorState } from "@/components/ui/ErrorState";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { scanMessage } from "@/lib/messageScanner";
import { useManagerLabels } from "@/lib/declutter/managerMode";
import { fetchMyOrderTalks, fetchOrderTalk, MY_ORDER_TALKS_KEY, orderTalkPhotoUrl, sendOrderMessage } from "@/lib/declutter/orderTalk";
import { talkTime } from "@/lib/declutter/talkTime";
import { dateDividerLabel } from "@/components/messages/chatView/chatViewHelpers";
import { FallbackImg } from "./FallbackImg";
import { focusSheetItself } from "./focusSheetItself";
import { useMarkTalkRead } from "./useMarkTalkRead";
import { Textarea } from "@/components/ui/textarea";
import { getLang, t as tr } from "@/lib/i18n/language";
import "@/lib/i18n/enChatParts";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// A3-27: the order card's step line, loaded only with the chat (it reads the cards' queries).
const OrderTalkStep = lazy(() => import("./OrderTalkStep"));
// Audit 11-10 F389: the photo picker and a sent photo load only when used, so this chunk does not grow.
const OrderTalkPhotoPicker = lazy(() => import("./OrderTalkPhotoParts").then((m) => ({ default: m.OrderTalkPhotoPicker })));
const OrderTalkMessagePhoto = lazy(() => import("./OrderTalkPhotoParts").then((m) => ({ default: m.OrderTalkMessagePhoto })));

// AUD31-12: the weekday alone only within 6 days; older lines carry their date.
const when = (iso: string) => talkTime(iso);
// F424 (audit 11-10): each line said "Mon 12:32 PM" where the job chat has Today / Yesterday dividers. Lines now sit
// under the job chat's own day dividers (dateDividerLabel) and carry the clock time only.
const clock = (iso: string) => new Date(iso).toLocaleTimeString(getLang() === "es" ? "es-US" : [], { hour: "numeric", minute: "2-digit" });

const dayKey = (iso: string) => new Date(iso).toDateString();

/** "Message the seller" / "Message the buyer" on a paid order card: puts ?order_talk=<order id> on the address. */
export function OrderTalkButton(props: { orderId: string; side: "buyer" | "seller"; trade?: boolean; /** Polish audit 11-27 #12: a 14px text button in the seller card's secondary row. */ quiet?: boolean }) {
  // The app always renders cards inside the router; a card rendered alone (unit tests of other card parts) has none.
  return useInRouterContext() ? <OrderTalkLinkButton {...props} /> : null;
}

function OrderTalkLinkButton({ orderId, side, trade = false, quiet = false }: { orderId: string; side: "buyer" | "seller"; trade?: boolean; quiet?: boolean }) {
  const [params, setParams] = useSearchParams();
  const open = () => {
    const next = new URLSearchParams(params);
    next.set("order_talk", orderId);
    setParams(next);
  };
  return (
    // Q2634 (audit 1102c R9): the card's other secondary button, Get help now, is the small outline; this matches it.
    <Button type="button" variant={quiet ? "link" : "outline"} size="sm" className={quiet ? "px-0 text-ds-14 font-semibold" : "rounded-full"} onClick={open}>
      {/* Lead 11-08: a trade has no buyer or seller to speak of; both sides talk about the trade. */}
      {trade ? tr("cp.ot.msgTrade") : side === "buyer" ? tr("cp.ot.msgSeller") : tr("cp.ot.msgBuyer")}
    </Button>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The chat for ?order_talk=<order id>; closing it takes the parameter off. */
export function OrderTalkFromLink() {
  const [params, setParams] = useSearchParams();
  // Deep audit 1122 #3: signed out, the server refuses the chat, and the sheet said "We couldn't load this chat. Check
  // your connection" with no way to log in (and logged an error). A guest gets the page's "Log in to see your order"
  // card instead (DeclutterGuestBrowseJoin, at every width); the link comes back here after log in.
  const { user } = useCurrentUser();
  const orderId = params.get("order_talk");
  if (!user || !orderId || !UUID.test(orderId)) return null;
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
  // B112: seen = read, so the unread reminders stop (on open and on each new message).
  useMarkTalkRead("order", orderId, talk.data ? talk.data.messages.length : null);
  // AUD31-13: the sheet names the item it is about, from the same list Messages -> Declutter reads (one cached read).
  const talks = useQuery({ queryKey: MY_ORDER_TALKS_KEY, queryFn: fetchMyOrderTalks });
  // Manager mode: a message the seller's manager wrote says "Dana (helping Kaci)" to everyone, not "The seller" (nor
  // "You" to the seller: it was sent under her account, but she did not write it).
  const labels = useManagerLabels("order_talk", (talk.data?.messages ?? []).map((m) => m.id));
  const itemRow = talks.data?.find((r) => r.order_id === orderId) ?? null;
  const itemTitle = itemRow?.title ?? null;
  // Audit 11-10 F360e: the chat's head shows the item's photo beside its title (the same photo_path the Messages row
  // shows, declutter_my_order_talks 20261111155616); none when the item or its photos are gone.
  const itemPhoto = itemRow ? orderTalkPhotoUrl(itemRow) : null;
  const [draft, setDraft] = useState("");
  // F389: at most one photo waits on the device; it is uploaded (private bucket, cleaned) only when Send is tapped.
  const [photo, setPhoto] = useState<File | null>(null);
  const leak = draft.trim() ? scanMessage(draft)[0] ?? null : null;
  // AUD31-11: a refused message is said under the box, as Questions does, never in a toast over the box and draft.
  const [refusal, setRefusal] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: async () => {
      // The upload helper (photo cleaning) is loaded only for a photo send.
      const handover = photo ? await import("@/lib/declutter/handover") : null;
      const photoPath = handover && photo ? await handover.uploadOrderTalkPhoto(orderId, photo) : null;
      try {
        return await sendOrderMessage(orderId, draft.trim(), photoPath);
      } catch (e) {
        // A refused send (contact details, rate limit, a block) leaves no photo behind in storage (best effort).
        if (handover && photoPath) await handover.discardRefusedHandoverPhoto(photoPath);
        throw e;
      }
    },
    // Messages -> Declutter's list (DeclutterOrderTalkInbox) shows who sent the last message: refresh it too.
    onSuccess: () => { setDraft(""); setPhoto(null); setRefusal(null); void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: MY_ORDER_TALKS_KEY }); },
    onError: (err) => setRefusal(declutterErrorMessage(err)),
  });
  const t = talk.data;
  const other = t?.side === "seller" ? "buyer" : "seller";
  // Area 08 H3 (design audit 11-18): every word of this chat follows the app language (enChatParts.ts cp.ot.*).
  const theOther = tr(other === "buyer" ? "cp.ot.theBuyer" : "cp.ot.theSeller");
  const open = !!t?.open;
  // AUD31-31: an ended chat is not titled as if it could still be sent to, and says when and why it ended.
  const endedAt = !open && t?.open_until && new Date(t.open_until).getTime() <= Date.now() ? t.open_until : null;
  const formId = `order-talk-form-${orderId}`;
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor={!webDesktop} onOpenAutoFocus={focusSheetItself}
        className={`bg-premium-page flex max-h-[90dvh] flex-col overflow-hidden ${webDesktop ? "sm:max-w-[520px]" : ""}`} data-order-talk="">
        {/* Audit 1122 #137: the sheet is a column. The head and the messages scroll; the message box with its Send
            button stays pinned at the bottom, so Send is on screen at 375 without scrolling (it measured 800-856px
            in an 812px viewport). One way to close: the sheet's own X (the second Close button is gone). */}
        <div className="min-h-0 flex-1 overflow-y-auto" data-order-talk-scroll="">
        <SheetHero title={!t ? tr("cp.ot.title") : open
          ? tr(other === "buyer" ? "cp.ot.msgBuyer" : "cp.ot.msgSeller")
          : tr(other === "buyer" ? "cp.ot.chatBuyer" : "cp.ot.chatSeller")} />
        {(itemTitle || itemPhoto) && (
          <div className="mt-1 flex items-center gap-3" data-order-talk-head="">
            {itemPhoto && <FallbackImg src={itemPhoto} alt="" className="h-11 w-11 shrink-0 rounded-xl bg-photo-empty object-cover" data-order-talk-photo="" />}
            {itemTitle && <p className="min-w-0 truncate text-ds-14 text-muted-foreground" data-order-talk-item="">{tr("cp.ot.about", { title: itemTitle })}</p>}
          </div>
        )}
        {talk.isError ? (
          <ErrorState variant="inline" title={tr("cp.ot.loadFailed")} body={declutterErrorMessage(talk.error)} onRetry={() => void talk.refetch()} />
        ) : talk.isPending || !t ? (
          <p className="mt-2 text-ds-14 text-muted-foreground">{tr("cp.ot.loading")}</p>
        ) : (
          <div className="mt-2 space-y-3">
            {/* A3-27 (audit 11-01): the same next step the order card shows, with its one button. */}
            {(t.side === "buyer" || t.side === "seller") && <Suspense fallback={null}><OrderTalkStep orderId={orderId} side={t.side} /></Suspense>}
            {/* Audit 11-10 F360e: from Messages there was no way back to the order itself; the order's own tab link
                (BUY-30's &order=) opens and scrolls to its card, and leaving this address closes the chat. */}
            {(t.side === "buyer" || t.side === "seller") && (
              <Link to={`/declutter?tab=${t.side === "seller" ? "selling" : "buying"}&order=${orderId}`} className="link-standard inline-flex min-h-11 items-center text-ds-14 font-semibold" data-order-talk-see-order="">{tr("cp.ot.seeOrder")}</Link>
            )}
            <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }}>
              {/* Audit 11-10 F390: one short line; a phone number or email is flagged under the box as it is typed. */}
              <span data-order-talk-rule="">{tr("cp.ot.rule")}</span>
              {open && t.open_until ? tr("cp.ot.openUntil", { when: when(t.open_until) }) : ""}
            </p>
            {!open && (
              <p className="rounded-xl border border-border bg-card px-3 py-2 text-ds-13 text-foreground" data-order-talk-ended="">
                {endedAt ? tr("cp.ot.endedAt", { when: when(endedAt) }) : tr("cp.ot.ended")}{tr("cp.ot.stillRead")}
              </p>
            )}
            <ol className="space-y-2" aria-label={tr("cp.ot.messages")}>
              {t.messages.length === 0 && <li className="text-ds-13 text-muted-foreground">{tr("cp.ot.none")}</li>}
              {t.messages.map((m, i) => [
                (i === 0 || dayKey(t.messages[i - 1].created_at) !== dayKey(m.created_at)) && (
                  <li key={`day-${m.id}`} role="separator" aria-label={tr("cp.ot.date", { day: dateDividerLabel(new Date(m.created_at)) })} data-order-talk-day=""
                    className="pt-2 text-center text-ds-10 font-semibold uppercase tracking-wider text-muted-foreground">
                    {dateDividerLabel(new Date(m.created_at))}
                  </li>
                ),
                <li key={m.id} className={`flex flex-col ${m.mine ? "items-end" : "items-start"}`}>
                  {/* Audit 1122 #137: the job chat's bubble (chatBubbleLook), with who and when on a small line under it,
                      as the job chat puts its time under the bubble; never a label inside the bubble. */}
                  <div className={`max-w-[85%] space-y-1 ${chatBubbleShape(m.mine)}`} style={chatBubbleStyle(m.mine)} data-order-talk-bubble={m.mine ? "mine" : "theirs"}>
                    {m.photo_path && <Suspense fallback={<div className="mt-1 h-40 w-40 rounded-xl bg-photo-empty" aria-hidden />}><OrderTalkMessagePhoto path={m.photo_path} /></Suspense>}
                    {/* F389: the other side's photo is hidden once either blocked the other or either is banned. */}
                    {m.photo_hidden && <p className="italic opacity-80" data-order-talk-photo-hidden="">{tr("cp.ot.photoHidden")}</p>}
                    {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  </div>
                  <p className="mt-1 px-1 text-ds-11 text-muted-foreground" data-order-talk-meta="">{labels.data?.get(m.id) ?? (m.mine ? tr("cp.ot.you") : theOther)} · {clock(m.created_at)}</p>
                </li>,
              ])}
            </ol>
          </div>
        )}
        </div>
        {t && open && !talk.isError && (
          <form id={formId} className="shrink-0 space-y-2 border-t border-border pt-3 pb-[max(var(--safe-area-bottom,0px),12px)]" data-order-talk-composer="" onSubmit={(e) => { e.preventDefault(); if (draft.trim() || photo) send.mutate(); }}>
            <label htmlFor={`order-talk-${orderId}`} className="sr-only">{tr("cp.ot.message")}</label>
            <Suspense fallback={null}><OrderTalkPhotoPicker file={photo} onChange={(f) => { setPhoto(f); setRefusal(null); }} disabled={send.isPending} /></Suspense>
            <div className="flex items-end gap-2">
              <Textarea id={`order-talk-${orderId}`} rows={1} className="min-h-11 max-h-32 flex-1 resize-none rounded-[22px] border border-input bg-background px-4 py-2.5 text-ds-14"
                maxLength={1000} value={draft} onChange={(e) => { setDraft(e.target.value); setRefusal(null); }}
                placeholder={tr(other === "buyer" ? "cp.ot.writeBuyer" : "cp.ot.writeSeller")}
                aria-invalid={refusal ? true : undefined} aria-describedby={refusal ? `order-talk-refusal-${orderId}` : leak ? `order-talk-leak-${orderId}` : undefined} />
              <Button type="submit" variant="primary" size="icon" className="shrink-0 rounded-full" aria-label={send.isPending ? tr("cp.ot.sending") : tr("cp.ot.send")}
                disabled={send.isPending || (draft.trim().length === 0 && !photo)}>
                <SendHorizontal className="h-5 w-5" aria-hidden />
              </Button>
            </div>
            {refusal && <p id={`order-talk-refusal-${orderId}`} role="alert" className="text-ds-13 text-destructive-ink" data-order-talk-refusal="">{refusal}</p>}
            {/* Audit 11-10 F390: said while typing, before Send, in the words the server refuses it with
                (reject_contact_leak_in_declutter_order_talk); the server stays the authority. */}
            {!refusal && leak && <p id={`order-talk-leak-${orderId}`} className="text-ds-13 text-foreground" data-order-talk-leak="">{leak.label} (&ldquo;{leak.match}&rdquo;). Keep contact details and payment out of the chat: this message won&apos;t send with it.</p>}
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
