/**
 * Messages -> Homes: the member's Homes chats (audit 11-05 A-H1, docs/NOT-LAUNCHED.md Q2209; server rentals_my_talks
 * in 20261106182837_homes_talk). Before: the Homes chip said "Chats with landlords and renters will show up here"
 * while no Homes chat could exist.
 *
 * Each row is one thread, both sides: the other side's first name (fair housing: nothing more; 42 U.S.C. 3604(c)),
 * the listing's headline, who wrote last and when, and "New" while the other side's last message is unread. Tapping
 * a row opens the same chat sheet as the listing page (?talk=<id>), over Messages. The server returns no person's id
 * and no message words for the list, so the row shows none.
 *
 * Mounted as the Homes chip's `Lead` (useMessageSections), only while the member has Homes (rentals_my_talks needs
 * the rentals switch): `empty` is the chip's empty state when it has no threads, null above threads.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Home } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { ListRow } from "@/components/ui/ListRow";
import { HomeTalkFromLink } from "@/components/rentals/listings/HomeTalk";
import { fetchMyHomeTalks, homeTalkErrorMessage, MY_HOME_TALKS_KEY, type HomeTalkRow } from "@/lib/rentals/talk";
import { CONVERSATION_ROW_AVATAR, CONVERSATION_ROW_FRAME } from "./ConversationRow";
import { rowAge } from "./rowAge";

/** "You wrote last" / "The owner wrote last" / "The member wrote last": all the row knows (no words). */
function homeTalkRowLine(row: Pick<HomeTalkRow, "side" | "last_mine">): string {
  if (row.last_mine) return "You wrote last";
  return row.side === "member" ? "The owner wrote last" : "The member wrote last";
}

export function HomeTalkRows({ empty }: { empty: ReactNode }) {
  const talks = useQuery({ queryKey: MY_HOME_TALKS_KEY, queryFn: fetchMyHomeTalks, staleTime: 30_000 });
  const [params, setParams] = useSearchParams();
  const openTalk = (talkId: string) => {
    const next = new URLSearchParams(params);
    next.set("talk", talkId);
    setParams(next);
  };
  if (talks.isError) {
    return (
      <div className={empty ? "px-3 py-3" : undefined}>
        <ErrorState variant="inline" title="We couldn't load your Homes chats." body={homeTalkErrorMessage(talks.error)} onRetry={() => void talks.refetch()} />
      </div>
    );
  }
  if (talks.isPending) return null;
  const rows = talks.data;
  if (rows.length === 0) return <>{empty}</>;
  return (
    // In the empty-threads branch the pane has no padding of its own (ConversationList), so the list brings it.
    <section className={empty ? "px-3 py-3" : undefined} aria-label="Homes chats" data-home-talk-list="">
      <ul className="space-y-1">
        {rows.map((row) => {
          const line = `${row.side === "owner" ? "Your listing" : "A home"}: ${row.listing_headline} · ${homeTalkRowLine(row)}`;
          return (
            <li key={row.talk_id}>
              <ListRow className={`${CONVERSATION_ROW_FRAME} justify-start`}
                onClick={() => openTalk(row.talk_id)} data-home-talk-row={row.talk_id}>
                <span className={`${CONVERSATION_ROW_AVATAR} shrink-0 rounded-full inline-flex items-center justify-center bg-muted text-muted-foreground`}
                  aria-hidden="true">
                  <Home className="w-5 h-5" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className={`font-sans truncate min-w-0 grow text-ds-15 ${row.unread ? "font-bold" : "font-semibold"}`} title={row.other_label}>{row.other_label}</span>
                    {row.unread && <span className="text-ds-11 font-semibold px-1.5 py-0.5 rounded-full shrink-0 bg-primary/10 text-foreground" data-home-talk-new="">New</span>}
                    <span className="ml-auto shrink-0 text-ds-11 text-muted-foreground whitespace-nowrap">{rowAge(row.last_at)}</span>
                  </span>
                  <span className="block text-ds-12 text-muted-foreground line-clamp-2 [overflow-wrap:anywhere]" data-home-talk-line="" title={line}>
                    {line}
                  </span>
                </span>
              </ListRow>
            </li>
          );
        })}
      </ul>
      {/* The chat sheet for a tapped row (?talk=), over Messages; closing it takes the parameter off. */}
      <HomeTalkFromLink />
    </section>
  );
}
