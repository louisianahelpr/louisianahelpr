/**
 * Message a shop (Shops H1, owner L48: any time, before and after ordering; migration 20261105185006_shops_talk).
 * A member's "Message" on a shop's page opens their one thread with that shop over the page (?talk=<id>, the link the
 * notices carry too). On their own shop's page the owner sees "Messages", one row per member who wrote, unread first
 * in bold. The server is the protection (shops_talk_view / shops_send_talk_message): only the two sides read or write,
 * and the contact-leak filter and the block check run there.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/ui/ListRow";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { ErrorState } from "@/components/ui/ErrorState";
import { Textarea } from "@/components/ui/textarea";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { talkTime } from "@/lib/declutter/talkTime";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { fetchMyShopTalks, fetchShopTalk, markShopTalkRead, MY_SHOP_TALKS_KEY, openShopOrderTalk, openShopRequestTalk, openShopTalk, sendShopTalkMessage, type ShopTalkView } from "@/lib/shops/talk";
import { focusSheetItself } from "@/components/declutter/focusSheetItself";
import { ShopCard } from "./ShopProfile";

const ReportDialog = lazy(() => import("@/components/ReportDialog"));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Q1947: Declutter's "Sell it for me" sheet opens a business's chat with ?ask=quote, and the message box starts with
 * this line for the member to finish and send (nothing is sent for them).
 */
export const QUOTE_DRAFT = "I'd like a quote to help sell my items: ";

function useTalkParam() {
  const [params, setParams] = useSearchParams();
  const talkId = params.get("talk");
  const set = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("talk", id); else { next.delete("talk"); next.delete("ask"); }
    setParams(next, { replace: !id });
  };
  return [talkId && UUID.test(talkId) ? talkId : null, set] as const;
}

/**
 * S2-026 (Shops audit 2): a closed chat says why when the shop's own state closed it (shops_talk_view.shop_off:
 * hidden, off Helpr, the owner's standing) and keeps the plain line for a block, which is never named.
 */
export function closedChatText(t: Pick<ShopTalkView, "side" | "shop_off">): string {
  if (!t.shop_off) return "This chat is closed. You can still read it.";
  return t.side === "buyer"
    ? "This shop isn't on Helpr right now, so the chat is closed. You can still read it."
    : "Your shop isn't showing on Helpr right now, so the chat is closed. You can still read it.";
}

/** A member's "Message" button on a shop's page: opens (or makes) their thread with the shop. */
export function ShopMessageButton({ shopId }: { shopId: string }) {
  const [, setTalk] = useTalkParam();
  const open = useMutation({ mutationFn: () => openShopTalk(shopId), onSuccess: (id) => setTalk(id) });
  return (
    <div className="space-y-1">
      <Button type="button" variant="outline" className="rounded-full" disabled={open.isPending} onClick={() => open.mutate()}>
        <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden />
        Message
      </Button>
      {open.isError && <p role="alert" className="text-ds-13 text-destructive-ink">{shopsErrorMessage(open.error)}</p>}
    </div>
  );
}

/**
 * Q1947: "Message" on a shop order's card, for either side (the buyer writes to the shop, the shop to the buyer). It
 * opens the same one thread per shop and member as the shop page's Message, over the orders screen (?talk=).
 */
export function ShopOrderMessageButton({ orderId, requestId, side }: { orderId?: string; requestId?: string; side: "buyer" | "shop" }) {
  const [, setTalk] = useTalkParam();
  // S2-018 (Shops audit 2): a custom request's card opens the same thread (shops_open_request_talk), so either side
  // can ask a question before a price is sent or ordered.
  const open = useMutation({
    mutationFn: () => (requestId ? openShopRequestTalk(requestId) : openShopOrderTalk(orderId ?? "")),
    onSuccess: (id) => setTalk(id),
  });
  return (
    <div className="space-y-1" data-shop-order-message="">
      <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={open.isPending} onClick={() => open.mutate()}>
        <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden />
        {side === "buyer" ? "Message the shop" : "Message the buyer"}
      </Button>
      {open.isError && <p role="alert" className="text-ds-13 text-destructive-ink">{shopsErrorMessage(open.error)}</p>}
    </div>
  );
}

/** The owner's threads on their own shop page. */
export function ShopTalksCard() {
  const [, setTalk] = useTalkParam();
  const talks = useQuery({ queryKey: MY_SHOP_TALKS_KEY, queryFn: fetchMyShopTalks });
  const mine = (talks.data ?? []).filter((t) => t.side === "shop");
  return (
    <ShopCard id="shop-messages" title="Messages">
      {talks.isError ? (
        <ErrorState variant="inline" title="We couldn't load your messages." body={shopsErrorMessage(talks.error)} onRetry={() => void talks.refetch()} />
      ) : talks.isPending ? (
        <p className="text-ds-13 text-muted-foreground" role="status">Loading…</p>
      ) : mine.length === 0 ? (
        <p className="text-ds-13 text-muted-foreground">When a shopper messages your shop, the chat shows up here.</p>
      ) : (
        <ul className="divide-y divide-border" data-shop-talks="">
          {mine.map((t) => (
            <li key={t.talk_id}>
              <ListRow onClick={() => setTalk(t.talk_id)} trailing={<span className="shrink-0 text-ds-12 text-muted-foreground">{talkTime(t.last_at)}</span>}>
                <span className={`truncate text-ds-13 ${t.unread ? "font-bold" : ""}`} title={t.other_label}>{t.other_label}{t.unread ? " · New" : ""}</span>
              </ListRow>
            </li>
          ))}
        </ul>
      )}
    </ShopCard>
  );
}

/** The thread for ?talk=<id>; closing it takes the parameter off. */
export function ShopTalkFromLink() {
  const [talkId, setTalk] = useTalkParam();
  const [params] = useSearchParams();
  if (!talkId) return null;
  return <ShopTalkSheet talkId={talkId} onClose={() => setTalk(null)} initialDraft={params.get("ask") === "quote" ? QUOTE_DRAFT : ""} />;
}

function ShopTalkSheet({ talkId, onClose, initialDraft = "" }: { talkId: string; onClose: () => void; initialDraft?: string }) {
  const webDesktop = useIsWebDesktop();
  const qc = useQueryClient();
  const key = ["shops", "talk", talkId] as const;
  // The newest message this open sheet has marked read: undefined until the first mark ("" for a chat with none).
  const markedNewest = useRef<string | undefined>(undefined);
  // A light poll while the thread is open (the other side's new message shows within 15 seconds).
  const talk = useQuery({ queryKey: key, queryFn: async () => {
    const view = await fetchShopTalk(talkId);
    // Seen = read, marked once per newest message (lead 11-05: the 15 s poll wrote every 15 s while a thread sat
    // open). A failed read mark only leaves the thread bold in the owner's list; the next poll tries again.
    const newest = view.messages[view.messages.length - 1]?.id ?? "";
    if (markedNewest.current !== newest) {
      markedNewest.current = newest;
      void markShopTalkRead(talkId).then(
        () => qc.invalidateQueries({ queryKey: MY_SHOP_TALKS_KEY }),
        () => { markedNewest.current = undefined; },
      );
    }
    return view;
  }, refetchInterval: 15_000 });
  const [draft, setDraft] = useState(initialDraft);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Q1947: the other side's message can be reported (shop_talk_message; the server refuses your own).
  const [reporting, setReporting] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => sendShopTalkMessage(talkId, draft.trim()),
    onSuccess: () => { setDraft(""); setRefusal(null); void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: MY_SHOP_TALKS_KEY }); },
    onError: (err) => setRefusal(shopsErrorMessage(err)),
  });
  const t = talk.data;
  const open = !!t?.open;
  const formId = `shop-talk-form-${talkId}`;
  // S2-036 (Shops audit 2): only the messages scroll; the chat opens (and stays) at the newest message.
  const listRef = useRef<HTMLDivElement>(null);
  const newestId = t?.messages[t.messages.length - 1]?.id;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newestId]);
  // S2-025 (Shops audit 2): a message from the other side that arrives while the chat is open is read out (a polite
  // live region); the ones already there when it opens are not.
  const seenNewest = useRef<string | null | undefined>(undefined);
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    if (!t) return;
    const last = t.messages[t.messages.length - 1];
    if (seenNewest.current === undefined) { seenNewest.current = last?.id ?? null; return; }
    if (!last || last.id === seenNewest.current) return;
    seenNewest.current = last.id;
    if (!last.mine) setAnnounce(`New message from ${t.other_label}: ${last.body}`);
  }, [t]);
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor={!webDesktop} onOpenAutoFocus={focusSheetItself}
        className={`bg-premium-page flex max-h-[90dvh] flex-col gap-0 overflow-hidden ${webDesktop ? "sm:max-w-[520px]" : ""}`} data-shop-talk="">
        {/* S2-036: the title and the reply box stay put; only the middle (note + messages) scrolls. */}
        <SheetHero title={t ? `Message ${t.other_label}` : "Messages"} />
        {talk.isError ? (
          <ErrorState variant="inline" title="We couldn't load this chat." body={shopsErrorMessage(talk.error)} onRetry={() => void talk.refetch()} />
        ) : talk.isPending || !t ? (
          <p className="mt-2 text-ds-14 text-muted-foreground">Loading…</p>
        ) : (
          <>
          <div ref={listRef} className="mt-2 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain" data-shop-talk-scroll="">
            <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }}>
              Only you and {t.side === "buyer" ? "the shop" : "this shopper"} can read this. Keep phone numbers, emails and payment out of the chat.
            </p>
            {!open && (
              <p className="rounded-xl border border-border bg-card px-3 py-2 text-ds-13 text-foreground" data-shop-talk-closed="">
                {closedChatText(t)}
              </p>
            )}
            <p className="sr-only" aria-live="polite" data-shop-talk-live="">{announce}</p>
            <ol className="space-y-2" aria-label="Messages">
              {t.messages.length === 0 && <li className="text-ds-13 text-muted-foreground">No messages yet. Ask about an item, an order or a pickup time.</li>}
              {t.messages.map((m) => (
                <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${m.mine ? "bg-[hsl(var(--bark)/0.1)]" : "border border-border bg-card"}`}>
                    <p className="text-ds-12 font-semibold text-muted-foreground">{m.mine ? "You" : t.other_label} · {talkTime(m.created_at)}</p>
                    <p className="whitespace-pre-wrap break-words text-ds-14 text-foreground">{m.body}</p>
                    {!m.mine && (
                      <Button type="button" variant="ghost" size="sm" data-report-shop-talk-message=""
                        className="mt-0.5 gap-1 px-1 text-ds-11 font-normal tracking-normal text-muted-foreground [&_svg]:size-3"
                        aria-label={`Report this message from ${t.other_label}`} onClick={() => setReporting(m.id)}>
                        <Flag className="h-3 w-3" aria-hidden />
                        Report
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
            {open && (
              <form id={formId} className="mt-3 shrink-0 space-y-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send.mutate(); }}>
                <label htmlFor={`shop-talk-${talkId}`} className="block text-ds-13 font-medium">Message</label>
                <Textarea id={`shop-talk-${talkId}`} className="min-h-16 w-full rounded-xl border border-input bg-background px-3 py-2 text-ds-14"
                  maxLength={1000} value={draft} onChange={(e) => { setDraft(e.target.value); setRefusal(null); }}
                  aria-invalid={refusal ? true : undefined}
                  aria-describedby={`shop-talk-count-${talkId}${refusal ? ` shop-talk-refusal-${talkId}` : ""}`} />
                {/* S2-025: the 1,000-character limit is shown, not a silent cut. */}
                <p id={`shop-talk-count-${talkId}`} className="text-right text-ds-12 text-muted-foreground" data-shop-talk-count="">
                  {draft.length}/1000
                </p>
                {refusal && <p id={`shop-talk-refusal-${talkId}`} role="alert" className="text-ds-13 text-destructive-ink">{refusal}</p>}
              </form>
            )}
          </>
        )}
        <SheetFooter className="mt-4 shrink-0">
          <SheetSecondaryAction onClick={onClose}>Close</SheetSecondaryAction>
          {open && (
            <SheetPrimaryAction type="submit" form={formId} disabled={send.isPending || draft.trim().length === 0}>
              {send.isPending ? "Sending…" : "Send"}
            </SheetPrimaryAction>
          )}
        </SheetFooter>
        {reporting && (
          <Suspense fallback={null}>
            <ReportDialog open onClose={() => setReporting(null)} reportedType="shop_talk_message" reportedId={reporting} />
          </Suspense>
        )}
      </SheetContent>
    </Sheet>
  );
}
