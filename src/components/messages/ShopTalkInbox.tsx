/**
 * Messages -> Shops: the member's shop chats (Q1947, the rest of Shops H1; server shops_my_talks in
 * 20261105185006_shops_talk). Before: a shop chat could only be reached from the shop's page, the owner's "Messages"
 * card or a notice, and the Shops chip said "Questions and order chats with local shops will show up here" while
 * showing none of them.
 *
 * Each row is one thread, both sides: as a shopper, the shop's name; as a shop's owner, the shopper's first name and
 * "Your shop". Who wrote last and when, and "New" while the other side's last message is unread. Tapping a row opens
 * the same chat sheet as the shop page (?talk=<id>), over Messages. The server returns no person's id and no message
 * words for the list, so the row shows none.
 *
 * Mounted by SectionInboxEmpty / ConversationList as the Shops chip's `Lead` (useMessageSections), only while the
 * member has Shops (shops_my_talks refuses without the switch): `empty` is the chip's empty state when it has no
 * threads, null above threads.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Store } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { ListRow } from "@/components/ui/ListRow";
import { ShopTalkFromLink } from "@/components/shops/ShopTalk";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { fetchMyShopTalks, MY_SHOP_TALKS_KEY, type ShopTalkRow } from "@/lib/shops/talk";
import { CONVERSATION_ROW_AVATAR, CONVERSATION_ROW_FRAME } from "./ConversationRow";
import { rowAge } from "./rowAge";

/** "You wrote last" / "The shop wrote last" / "The shopper wrote last": all the row knows (no words). */
export function shopTalkRowLine(row: Pick<ShopTalkRow, "side" | "last_mine">): string {
  if (row.last_mine) return "You wrote last";
  return row.side === "buyer" ? "The shop wrote last" : "The shopper wrote last";
}

export function ShopTalkRows({ empty, onlyUnread = false }: { empty: ReactNode; onlyUnread?: boolean }) {
  const talks = useQuery({ queryKey: MY_SHOP_TALKS_KEY, queryFn: fetchMyShopTalks, staleTime: 30_000 });
  const [params, setParams] = useSearchParams();
  const openTalk = (talkId: string) => {
    const next = new URLSearchParams(params);
    next.set("talk", talkId);
    setParams(next);
  };
  if (talks.isError) {
    return (
      <div className={empty ? "px-3 py-3" : undefined}>
        <ErrorState variant="inline" title="We couldn't load your shop chats." body={shopsErrorMessage(talks.error)} onRetry={() => void talks.refetch()} />
      </div>
    );
  }
  if (talks.isPending) return null;
  // S2-016: Messages -> Unread lists only the chats with an unread message.
  const rows = onlyUnread ? talks.data.filter((r) => r.unread) : talks.data;
  if (rows.length === 0) return <>{empty}</>;
  return (
    // In the empty-threads branch the pane has no padding of its own (ConversationList), so the list brings it.
    <section className={empty ? "px-3 py-3" : undefined} aria-label="Shop chats" data-shop-talk-list="">
      <ul className="space-y-1">
        {rows.map((row) => {
          const line = `${row.side === "shop" ? "Your shop" : "A shop"} · ${shopTalkRowLine(row)}`;
          return (
            <li key={row.talk_id}>
              <ListRow className={`${CONVERSATION_ROW_FRAME} justify-start`}
                onClick={() => openTalk(row.talk_id)} data-shop-talk-row={row.talk_id}>
                <span className={`${CONVERSATION_ROW_AVATAR} shrink-0 rounded-full inline-flex items-center justify-center bg-muted text-muted-foreground`}
                  aria-hidden="true">
                  <Store className="w-5 h-5" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className={`font-sans truncate min-w-0 grow text-ds-15 ${row.unread ? "font-bold" : "font-semibold"}`} title={row.other_label}>{row.other_label}</span>
                    {row.unread && <span className="text-ds-11 font-semibold px-1.5 py-0.5 rounded-full shrink-0 bg-primary/10 text-foreground" data-shop-talk-new="">New</span>}
                    <span className="ml-auto shrink-0 text-ds-11 text-muted-foreground whitespace-nowrap">{rowAge(row.last_at)}</span>
                  </span>
                  <span className="block text-ds-12 text-muted-foreground line-clamp-2 [overflow-wrap:anywhere]" data-shop-talk-line="" title={line}>
                    {line}
                  </span>
                </span>
              </ListRow>
            </li>
          );
        })}
      </ul>
      {/* The chat sheet for a tapped row (?talk=), over Messages; closing it takes the parameter off. */}
      <ShopTalkFromLink />
    </section>
  );
}
