/**
 * Message the owner of a home (audit 11-05 A-H1, docs/NOT-LAUNCHED.md Q2209; server 20261106182837_homes_talk).
 * A member's "Message the owner" on a listing page opens their one thread about that listing over the page
 * (?talk=<id>, the link the notices carry too). The owner reaches the same sheet from the notice or from
 * Messages -> Homes. The server is the protection (rentals_talk_view / rentals_send_talk_message): only the two sides
 * read or write, each sees only the other's first name (42 U.S.C. 3604(c); La. R.S. 51:2606), and the contact-leak
 * filter (owner Q49) and the block check run there. A for-sale thread carries the wire-fraud line (audit D-M1).
 */
import { lazy, Suspense, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { ErrorState } from "@/components/ui/ErrorState";
import { Textarea } from "@/components/ui/textarea";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { talkTime } from "@/lib/declutter/talkTime";
import { fetchHomeTalk, homeTalkErrorMessage, markHomeTalkRead, MY_HOME_TALKS_KEY, openHomeTalk, sendHomeTalkMessage, WIRE_FRAUD_LINE } from "@/lib/rentals/talk";
import { focusSheetItself } from "@/components/declutter/focusSheetItself";

const ReportDialog = lazy(() => import("@/components/ReportDialog"));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function useTalkParam() {
  const [params, setParams] = useSearchParams();
  const talkId = params.get("talk");
  const set = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("talk", id); else next.delete("talk");
    setParams(next, { replace: !id });
  };
  return [talkId && UUID.test(talkId) ? talkId : null, set] as const;
}

/** "Message the owner" on someone else's listing: opens (or makes) the member's thread about it. */
export function HomeMessageButton({ listingId }: { listingId: string }) {
  const [, setTalk] = useTalkParam();
  const open = useMutation({ mutationFn: () => openHomeTalk(listingId), onSuccess: (id) => setTalk(id) });
  return (
    <div className="space-y-1 px-1" data-home-message-owner="">
      <Button type="button" variant="outline" className="rounded-full" disabled={open.isPending} onClick={() => open.mutate()}>
        <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden />
        Message the owner
      </Button>
      {open.isError && <p role="alert" className="text-ds-13 text-destructive-ink">{homeTalkErrorMessage(open.error)}</p>}
    </div>
  );
}

/** The thread for ?talk=<id>; closing it takes the parameter off. */
export function HomeTalkFromLink() {
  const [talkId, setTalk] = useTalkParam();
  if (!talkId) return null;
  return <HomeTalkSheet talkId={talkId} onClose={() => setTalk(null)} />;
}

function HomeTalkSheet({ talkId, onClose }: { talkId: string; onClose: () => void }) {
  const webDesktop = useIsWebDesktop();
  const qc = useQueryClient();
  const key = ["rentals", "talk", talkId] as const;
  // The newest message this open sheet has marked read: undefined until the first mark ("" for a chat with none).
  const markedNewest = useRef<string | undefined>(undefined);
  // A light poll while the thread is open (the other side's new message shows within 15 seconds). Seen = read,
  // marked once per newest message, as in Shops (the poll does not write every 15 s).
  const talk = useQuery({ queryKey: key, queryFn: async () => {
    const view = await fetchHomeTalk(talkId);
    const newest = view.messages[view.messages.length - 1]?.id ?? "";
    if (markedNewest.current !== newest) {
      markedNewest.current = newest;
      // A failed read mark only leaves the thread bold in Messages; the next poll tries again.
      void markHomeTalkRead(talkId).then(
        () => qc.invalidateQueries({ queryKey: MY_HOME_TALKS_KEY }),
        () => { markedNewest.current = undefined; },
      );
    }
    return view;
  }, refetchInterval: 15_000 });
  const [draft, setDraft] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  // The other side's message can be reported (home_talk_message, 20261106191100; the server refuses your own).
  const [reporting, setReporting] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => sendHomeTalkMessage(talkId, draft.trim()),
    onSuccess: () => { setDraft(""); setRefusal(null); void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: MY_HOME_TALKS_KEY }); },
    onError: (err) => setRefusal(homeTalkErrorMessage(err)),
  });
  const t = talk.data;
  const open = !!t?.open;
  const formId = `home-talk-form-${talkId}`;
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor={!webDesktop} onOpenAutoFocus={focusSheetItself}
        className={`bg-premium-page max-h-[90dvh] overflow-y-auto ${webDesktop ? "sm:max-w-[520px]" : ""}`} data-home-talk="">
        <SheetHero title={t ? `Message ${t.other_label}` : "Messages"} />
        {talk.isError ? (
          <ErrorState variant="inline" title="We couldn't load this chat." body={homeTalkErrorMessage(talk.error)} onRetry={() => void talk.refetch()} />
        ) : talk.isPending || !t ? (
          <p className="mt-2 text-ds-14 text-muted-foreground">Loading…</p>
        ) : (
          <div className="mt-2 space-y-3">
            <p className="truncate text-ds-13 font-medium text-muted-foreground" title={t.listing_headline}>About: {t.listing_headline}</p>
            <p className="rounded-xl px-3 py-2 text-ds-13 text-foreground" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }}>
              Only you and {t.side === "member" ? "the owner" : "this member"} can read this. Keep phone numbers, emails and payment out of the chat.
            </p>
            {t.listing_kind === "sale" && (
              <p className="rounded-xl border border-border bg-card px-3 py-2 text-ds-13 font-medium text-foreground" data-home-talk-wire="">
                {WIRE_FRAUD_LINE}
              </p>
            )}
            {!open && (
              <p className="rounded-xl border border-border bg-card px-3 py-2 text-ds-13 text-foreground" data-home-talk-closed="">
                This chat is closed. You can still read it.
              </p>
            )}
            <ol className="space-y-2" aria-label="Messages">
              {t.messages.length === 0 && <li className="text-ds-13 text-muted-foreground">No messages yet. Ask about the home, a viewing or the move-in date.</li>}
              {t.messages.map((m) => (
                <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${m.mine ? "bg-[hsl(var(--bark)/0.1)]" : "border border-border bg-card"}`}>
                    <p className="text-ds-12 font-semibold text-muted-foreground">{m.mine ? "You" : t.other_label} · {talkTime(m.created_at)}</p>
                    <p className="whitespace-pre-wrap break-words text-ds-14 text-foreground">{m.body}</p>
                    {!m.mine && (
                      <Button type="button" variant="ghost" size="sm" data-report-home-talk-message=""
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
            {open && (
              <form id={formId} className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send.mutate(); }}>
                <label htmlFor={`home-talk-${talkId}`} className="block text-ds-13 font-medium">Message</label>
                <Textarea id={`home-talk-${talkId}`} className="min-h-20 w-full rounded-xl border border-input bg-background px-3 py-2 text-ds-14"
                  maxLength={1000} value={draft} onChange={(e) => { setDraft(e.target.value); setRefusal(null); }}
                  aria-invalid={refusal ? true : undefined} aria-describedby={refusal ? `home-talk-refusal-${talkId}` : undefined} />
                {refusal && <p id={`home-talk-refusal-${talkId}`} role="alert" className="text-ds-13 text-destructive-ink">{refusal}</p>}
              </form>
            )}
          </div>
        )}
        <SheetFooter className="mt-4">
          <SheetSecondaryAction onClick={onClose}>Close</SheetSecondaryAction>
          {open && (
            <SheetPrimaryAction type="submit" form={formId} disabled={send.isPending || draft.trim().length === 0}>
              {send.isPending ? "Sending…" : "Send"}
            </SheetPrimaryAction>
          )}
        </SheetFooter>
        {reporting && (
          <Suspense fallback={null}>
            <ReportDialog open onClose={() => setReporting(null)} reportedType="home_talk_message" reportedId={reporting} />
          </Suspense>
        )}
      </SheetContent>
    </Sheet>
  );
}
