/**
 * The handover chat (owner 2026-10-28, Q2462 / issue #3730: when none of the ways the seller ticked works for a
 * buyer, "let them chat to figure it out"; server 20261028235249_declutter_handover_talk).
 *
 *   NoWayWorks      the buyer's checkout, when no way the seller offers is open to them: says so, and
 *                   "Message the seller" opens the chat.
 *   SellerTalks     the seller's Selling tab: each open chat a buyer started, with "Open chat".
 *   HandoverTalkSheet  the chat itself, opened on /declutter?talk=<id> (the notices link there too). The whole
 *                   history, a message box, and for the seller "Add porch pickup" on the items it is about.
 *
 * Names stay out: the two are "the buyer" and "the seller". Every message goes through
 * declutter_send_handover_message, whose contact-leak filter refuses a phone number, email or payment handle with
 * words the member reads (declutterErrorMessage passes them through).
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { ErrorState } from "@/components/ui/ErrorState";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import {
  addHandover,
  fetchHandoverTalk,
  fetchMyOpenHandoverTalks,
  fetchTalkItems,
  openHandoverTalk,
  sendHandoverMessage,
} from "@/lib/declutter/handoverTalk";
import { talkTime } from "@/lib/declutter/talkTime";
import { focusSheetItself } from "./focusSheetItself";

// AUD31-12: the weekday alone only within 6 days; older lines carry their date.
const when = (iso: string) => talkTime(iso);

/** Puts ?talk=<id> on the current address (the Declutter page opens the chat from it). */
function useOpenTalk() {
  const [params, setParams] = useSearchParams();
  return (id: string) => {
    const next = new URLSearchParams(params);
    next.set("talk", id);
    setParams(next);
  };
}

/** The buyer's checkout when none of the seller's ways is open to them: no Pay, a way to talk it through. */
export function NoWayWorks({ sellerId, who = "seller" }: { sellerId: string; who?: "seller" | "giver" }) {
  const open = useOpenTalk();
  const start = useMutation({
    mutationFn: () => openHandoverTalk(sellerId),
    onSuccess: (id) => open(id),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return (
    <div className="space-y-2 rounded-[20px] border border-border bg-card p-4" data-no-way-works="">
      <p className="text-ds-14 text-foreground">
        None of the ways this {who} offers works for you here. Message the {who} to agree one. Your checkout time waits
        while you talk (up to 3 days), and nobody gets a strike if you can't agree.
      </p>
      <Button type="button" variant="ghost" size="sm" className="border border-border py-2 text-sm font-semibold tracking-normal disabled:opacity-100"
        disabled={start.isPending} onClick={() => start.mutate()}>
        {start.isPending ? "Opening…" : `Message the ${who}`}
      </Button>
    </div>
  );
}

/** The seller's open chats (a buyer could not check out with any way they offer). Nothing when there are none. */
export function SellerTalks() {
  const { user } = useCurrentUser();
  const open = useOpenTalk();
  const talks = useQuery({
    queryKey: ["declutter", "handover-talks", user?.id],
    queryFn: () => fetchMyOpenHandoverTalks(user!.id),
    enabled: !!user,
  });
  if (talks.isError) {
    return <ErrorState variant="inline" title="We couldn't load your handover chats." body={declutterErrorMessage(talks.error)} onRetry={() => void talks.refetch()} />;
  }
  const mine = (talks.data ?? []).filter((t) => t.seller_id === user?.id);
  if (mine.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Buyers who want to agree a handover">
      <h2 className="text-base font-semibold">Agree a handover</h2>
      <ul className="space-y-3">
        {mine.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
            <p className="min-w-0 flex-1 text-sm">A buyer can't use any way you offer. The chat is open until {when(t.expires_at)}.</p>
            <button type="button" className="min-h-11 shrink-0 rounded-full border border-border px-4 py-2 text-sm font-semibold" onClick={() => open(t.id)}>
              Open chat
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The chat for ?talk=<id>; closing it takes the parameter off. */
export function HandoverTalkFromLink() {
  const [params, setParams] = useSearchParams();
  const talkId = params.get("talk");
  if (!talkId) return null;
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("talk");
    setParams(next, { replace: true });
  };
  return <HandoverTalkSheet talkId={talkId} onClose={close} />;
}

function HandoverTalkSheet({ talkId, onClose }: { talkId: string; onClose: () => void }) {
  const webDesktop = useIsWebDesktop();
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  const key = ["declutter", "handover-talk", talkId] as const;
  // A light poll while the chat is open (the other side's new message shows within 15 seconds; never while hidden).
  const talk = useQuery({ queryKey: key, queryFn: () => fetchHandoverTalk(talkId), refetchInterval: 15_000 });
  const [draft, setDraft] = useState("");
  const send = useMutation({
    mutationFn: () => sendHandoverMessage(talkId, draft.trim()),
    onSuccess: () => { setDraft(""); void qc.invalidateQueries({ queryKey: key }); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const t = talk.data?.talk;
  const iAmSeller = !!t && t.seller_id === user?.id;
  const other = iAmSeller ? "buyer" : "seller";
  const ended = !!t && (t.closed_at !== null || new Date(t.expires_at).getTime() <= Date.now());
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor={!webDesktop} onOpenAutoFocus={focusSheetItself}
        className={`bg-premium-page max-h-[90dvh] overflow-y-auto ${webDesktop ? "sm:max-w-[520px]" : ""}`} data-handover-talk="">
        <SheetHero title="Agree the handover" />
        {talk.isError ? (
          <ErrorState variant="inline" title="We couldn't load this chat." body={declutterErrorMessage(talk.error)} onRetry={() => void talk.refetch()} />
        ) : talk.isPending ? (
          <p className="mt-2 text-ds-14 text-muted-foreground">Loading…</p>
        ) : !t ? (
          <p className="mt-2 text-ds-14 text-muted-foreground">This chat isn't available. It may belong to another sale.</p>
        ) : (
          <div className="mt-2 space-y-3">
            <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }}>
              Only you and the {other} can read this. Keep phone numbers, emails and payment out of the chat.
              {ended ? " This chat has ended." : ` It's open until ${when(t.expires_at)}.`}
            </p>
            <ol className="space-y-2" aria-label="Messages">
              {talk.data!.messages.length === 0 && <li className="text-ds-13 text-muted-foreground">No messages yet. Say which way could work for you.</li>}
              {talk.data!.messages.map((m) => {
                const mine = m.sender_id === user?.id;
                return (
                  <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${mine ? "bg-[hsl(var(--bark)/0.1)]" : "border border-border bg-card"}`}>
                      <p className="text-ds-12 font-semibold text-muted-foreground">{mine ? "You" : `The ${other}`} · {when(m.created_at)}</p>
                      <p className="whitespace-pre-wrap break-words text-ds-14 text-foreground">{m.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {iAmSeller && !ended && <AddPorchPickup sellerId={t.seller_id} buyerId={t.buyer_id} />}
            {!ended && (
              <form id={`talk-form-${talkId}`} className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send.mutate(); }}>
                <label htmlFor={`talk-${talkId}`} className="block text-ds-13 font-medium">Message</label>
                <textarea id={`talk-${talkId}`} className="min-h-20 w-full rounded-xl border border-input bg-background px-3 py-2 text-ds-14"
                  maxLength={1000} value={draft} onChange={(e) => setDraft(e.target.value)} />
              </form>
            )}
          </div>
        )}
        {/* The shared popup footer: Close, and Send while the chat is open (it submits the form above). */}
        <SheetFooter className="mt-4">
          <SheetSecondaryAction onClick={onClose}>Close</SheetSecondaryAction>
          {t && !ended && (
            <SheetPrimaryAction type="submit" form={`talk-form-${talkId}`} disabled={send.isPending || draft.trim().length === 0}>
              {send.isPending ? "Sending…" : "Send"}
            </SheetPrimaryAction>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** The seller's one way out of a talk: porch pickup on the items it is about (it can't be taken off again). */
function AddPorchPickup({ sellerId, buyerId }: { sellerId: string; buyerId: string }) {
  const qc = useQueryClient();
  const key = ["declutter", "handover-talk-items", sellerId, buyerId] as const;
  const items = useQuery({ queryKey: key, queryFn: () => fetchTalkItems(sellerId, buyerId) });
  const add = useMutation({
    mutationFn: (itemId: string) => addHandover(itemId, "porch"),
    onSuccess: () => { toast("Porch pickup added. The buyer is told and has at least a day to check out."); void qc.invalidateQueries({ queryKey: ["declutter"] }); },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (items.isError) {
    return <ErrorState variant="inline" title="We couldn't load the items." body={declutterErrorMessage(items.error)} onRetry={() => void items.refetch()} />;
  }
  const noPorch = (items.data ?? []).filter((i) => Array.isArray(i.handovers) && !i.handovers.includes("porch"));
  if (noPorch.length === 0) return null;
  return (
    <div className="space-y-2 rounded-[20px] border border-border bg-card p-3" data-add-porch="">
      <p className="text-ds-13 text-foreground">Can the buyer pick it up from your porch? Add porch pickup and they can check out. You can't take it off later.</p>
      <ul className="space-y-2">
        {noPorch.map((i) => (
          <li key={i.item_id}>
            <button type="button" className="min-h-11 w-full rounded-full border border-border px-4 py-2 text-left text-sm font-semibold"
              disabled={add.isPending} onClick={() => add.mutate(i.item_id)}>
              Add porch pickup to {i.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
