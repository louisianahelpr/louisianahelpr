/**
 * Messages -> Declutter: the member's order chats (audit 1028 part 2, D2-1; server declutter_my_order_talks in
 * 20261030004216_declutter_order_talk). Before: a paid order's chat could only be reached from the order card or a
 * notice, and the Declutter chip said "When you buy or sell an item, your chats with the other person will show up
 * here" while showing none of them.
 *
 * Each row is one paid order's chat: the item, which side you are on, who sent the last message and when, and
 * "Ended" once it has closed. Tapping a row opens the same chat sheet as the order card (?order_talk=<order id>),
 * over Messages, so it works with the Declutter switch off too (a paid sale carries on, row 62). The server returns
 * no person's id or name and no message words, so the row shows none.
 *
 * Mounted by SectionInboxEmpty / ConversationList as the Declutter chip's `Lead` (useMessageSections): `empty` is
 * the chip's empty state when it has no threads (shown only once the list is known to be empty), null above threads.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Sofa } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { OrderTalkFromLink } from "@/components/declutter/DeclutterOrderTalk";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { fetchMyOrderTalks, MY_ORDER_TALKS_KEY, type OrderTalkListRow } from "@/lib/declutter/orderTalk";
import { CONVERSATION_ROW_AVATAR, CONVERSATION_ROW_FRAME } from "./ConversationRow";
import { rowAge } from "./rowAge";

/**
 * "You wrote last" / "The seller wrote last": all the row knows (no words, no names). AUD31-14: "sent the last
 * message" was cut at 375 ("The seller sent the l…"); the short words fit, and the line may take a second line.
 */
export function orderTalkRowLine(row: Pick<OrderTalkListRow, "side" | "last_mine">): string {
  const other = row.side === "buyer" ? "seller" : "buyer";
  return row.last_mine ? "You wrote last" : `The ${other} wrote last`;
}

export function DeclutterOrderTalkRows({ empty }: { empty: ReactNode }) {
  const talks = useQuery({ queryKey: MY_ORDER_TALKS_KEY, queryFn: fetchMyOrderTalks, staleTime: 30_000 });
  const [params, setParams] = useSearchParams();
  const openTalk = (orderId: string) => {
    const next = new URLSearchParams(params);
    next.set("order_talk", orderId);
    setParams(next);
  };
  if (talks.isError) {
    return (
      <div className={empty ? "px-3 py-3" : undefined}>
        <ErrorState variant="inline" title="We couldn't load your order chats." body={declutterErrorMessage(talks.error)} onRetry={() => void talks.refetch()} />
      </div>
    );
  }
  if (talks.isPending) return null;
  const rows = talks.data;
  if (rows.length === 0) return <>{empty}</>;
  return (
    // In the empty-threads branch the pane has no padding of its own (ConversationList), so the list brings it.
    <section className={empty ? "px-3 py-3" : undefined} aria-label="Order chats" data-order-talk-list="">
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.order_id}>
            <button type="button" className={`${CONVERSATION_ROW_FRAME} rounded-xl ctl-tint`}
              onClick={() => openTalk(row.order_id)} data-order-talk-row={row.order_id}>
              <span className={`${CONVERSATION_ROW_AVATAR} shrink-0 rounded-full inline-flex items-center justify-center bg-muted text-muted-foreground`}
                aria-hidden="true">
                <Sofa className="w-5 h-5" strokeWidth={1.75} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="font-sans font-semibold truncate min-w-0 grow text-ds-15" title={row.title ?? "Your order"}>{row.title ?? "Your order"}</span>
                  {!row.open && <span className="text-ds-11 font-semibold px-1.5 py-0.5 rounded-full shrink-0 bg-muted text-muted-foreground">Ended</span>}
                  <span className="ml-auto shrink-0 text-ds-11 text-muted-foreground whitespace-nowrap">{rowAge(row.last_at)}</span>
                </span>
                <span className="block text-ds-12 text-muted-foreground line-clamp-2 [overflow-wrap:anywhere]" data-order-talk-line=""
                  title={`${row.side !== "buyer" ? "You sold this" : "You bought this"} · ${orderTalkRowLine(row)}`}>
                  {row.side === "buyer" ? "You bought this" : "You sold this"} · {orderTalkRowLine(row)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {/* The chat sheet for a tapped row (?order_talk=), over Messages; closing it takes the parameter off. */}
      <OrderTalkFromLink />
    </section>
  );
}
