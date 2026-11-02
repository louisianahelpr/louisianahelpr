/**
 * The manager acts for the seller (owner 11-01, "Manage my Declutter for me"; L32 found manageForSeller had no screen,
 * B162 11-02). Shown under the manager's "<Seller>'s" view, only for the parts the seller turned on:
 *   - offers waiting on the seller: Decline | Accept (respond_offer);
 *   - questions with no answer: an answer box (answer_question; the buyer sees "<Manager> (helping <Seller>)");
 *   - drafts: Send to <Seller> for OK (submit_for_approval). The manager never posts: the seller approves each one from
 *     her "Waiting for your OK" list (owner 11-01 5:05 PM), and the server refuses a change while she is deciding.
 * Every call goes through declutter_manage, which checks the grant and the part on the server.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatPrice } from "@/lib/declutter/distance";
import { userFacingError } from "@/lib/userFacingError";
import { manageForSeller, type ManagedOverview, type ManagerGrant } from "@/lib/declutter/managerMode";

type Props = { g: ManagerGrant; o: ManagedOverview; refresh: () => void };

function OfferRow({ g, offer, title, refresh }: Props & { offer: ManagedOverview["offers"][number]; title: string }) {
  const answer = useMutation({
    mutationFn: (action: "accept" | "decline") => manageForSeller(g.seller_id, "respond_offer", { offer_id: offer.id, action }),
    onSuccess: (_r, action) => { toast(action === "accept" ? "Offer accepted." : "Offer declined."); refresh(); },
    onError: (e: unknown) => toast(userFacingError(e, "We couldn't answer that offer. Try again.")),
  });
  return (
    <li className="flex flex-wrap items-center gap-3 py-2" data-act-offer={offer.id}>
      <p className="min-w-[12rem] flex-1 text-ds-14">{offer.buyer_first_name} offered {formatPrice(offer.amount_cents)} for {title}</p>
      <Button variant="outline" className="rounded-full" disabled={answer.isPending} onClick={() => answer.mutate("decline")}>Decline</Button>
      <Button className="rounded-full" disabled={answer.isPending} onClick={() => answer.mutate("accept")}>Accept</Button>
    </li>
  );
}

function QuestionRow({ g, q, title, refresh }: Props & { q: ManagedOverview["questions"][number]; title: string }) {
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: () => manageForSeller(g.seller_id, "answer_question", { question_id: q.id, answer: text.trim() }),
    onSuccess: () => { toast("Answer sent."); setText(""); refresh(); },
    onError: (e: unknown) => toast(userFacingError(e, "We couldn't send that answer. Try again.")),
  });
  return (
    <li className="py-2" data-act-question={q.id}>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }}>
        <label htmlFor={`act-answer-${q.id}`} className="block text-ds-14">
          <span className="font-medium">{title}:</span> {q.question}
        </label>
        <Textarea id={`act-answer-${q.id}`} className="min-h-20" maxLength={500} value={text}
          onChange={(e) => setText(e.target.value)} placeholder={`Answer for ${g.seller_first_name}`} />
        <div className="flex justify-end">
          <Button type="submit" className="rounded-full" disabled={!text.trim() || send.isPending}>Send answer</Button>
        </div>
      </form>
    </li>
  );
}

function DraftRow({ g, item, refresh }: Props & { item: ManagedOverview["items"][number] }) {
  const submit = useMutation({
    mutationFn: () => manageForSeller(g.seller_id, "submit_for_approval", { item_id: item.id }),
    onSuccess: () => { toast(`Sent to ${g.seller_first_name}.`); refresh(); },
    onError: (e: unknown) => toast(userFacingError(e, "We couldn't send that. Try again.")),
  });
  return (
    <li className="flex flex-wrap items-center gap-3 py-2" data-act-draft={item.id}>
      <p className="min-w-[12rem] flex-1 truncate text-ds-14">{item.title}</p>
      <Button className="rounded-full" disabled={submit.isPending} onClick={() => submit.mutate()}>Send to {g.seller_first_name} for OK</Button>
    </li>
  );
}

export function ManagerActForSeller({ g, o, refresh }: Props) {
  const titleOf = (id: string) => o.items.find((i) => i.id === id)?.title ?? "an item";
  const offers = o.parts.offers ? o.offers.filter((x) => x.awaiting === "seller") : [];
  const questions = o.parts.messages ? o.questions.filter((x) => !x.answer) : [];
  const drafts = o.parts.list ? o.items.filter((i) => i.status === "draft") : [];
  if (offers.length + questions.length + drafts.length === 0) return null;
  return (
    <div className="space-y-3" data-manager-act="">
      {offers.length > 0 && (
        <div>
          <h3 className="text-ds-14 font-semibold">Offers</h3>
          <ul className="divide-y divide-border">
            {offers.map((x) => <OfferRow key={x.id} g={g} o={o} refresh={refresh} offer={x} title={titleOf(x.item_id)} />)}
          </ul>
        </div>
      )}
      {questions.length > 0 && (
        <div>
          <h3 className="text-ds-14 font-semibold">Questions</h3>
          <ul className="divide-y divide-border">
            {questions.map((q) => <QuestionRow key={q.id} g={g} o={o} refresh={refresh} q={q} title={titleOf(q.item_id)} />)}
          </ul>
        </div>
      )}
      {drafts.length > 0 && (
        <div>
          <h3 className="text-ds-14 font-semibold">Drafts</h3>
          <ul className="divide-y divide-border">
            {drafts.map((i) => <DraftRow key={i.id} g={g} o={o} refresh={refresh} item={i} />)}
          </ul>
        </div>
      )}
    </div>
  );
}
