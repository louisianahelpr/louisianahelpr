/**
 * Messages: the member's Declutter order chats as inbox rows (audit 1028 part 2, D2-1; server
 * declutter_my_order_talks in 20261030004216_declutter_order_talk). Before D2-1 a paid order's chat could only be
 * reached from the order card or a notice.
 *
 * F420 (whole-app audit 2026-11-10): "All shows only job chats; Declutter order chats only under the Declutter pill".
 * The rows now sit IN the inbox list (ConversationListBody), mixed with the job threads newest first, under All and
 * under the Declutter chip; Jobs / Declutter stay filters. Until then this file's `DeclutterOrderTalkRows` was the
 * Declutter chip's `Lead`: a separate block above (or instead of) the threads, reachable only from that chip.
 *
 * Each row is one paid order's chat: the item, which side you are on, who sent the last message and when, and
 * "Ended" once it has closed. Tapping a row opens the same chat sheet as the order card (?order_talk=<order id>),
 * over Messages, so it works with the Declutter switch off too (a paid sale carries on, row 62). The server returns
 * no person's id or name and no message words, so the row shows none.
 */
import { useSearchParams } from "react-router-dom";
import { Sofa } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { ListRow } from "@/components/ui/ListRow";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { orderTalkPhotoUrl, type OrderTalkListRow } from "@/lib/declutter/orderTalk";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { CONVERSATION_ROW_AVATAR, CONVERSATION_ROW_FRAME, UNREAD_MARK } from "./ConversationRow";
import { MESSAGE_STATUS_CHIP } from "./messageStatusChip";
import { rowAge } from "./rowAge";
import "@/lib/i18n/enMessages";
import { t } from "@/lib/i18n/language";

/** What useMessageSections hands the list: the order chats that belong under the chosen chip, or null when none do. */
export interface OrderTalkInbox {
  rows: OrderTalkListRow[];
  /** True until the first answer is in: the list holds its empty state until then (D2-1). */
  pending: boolean;
  error: unknown;
  reload: () => void;
}

/**
 * "You wrote last" / "The seller wrote last": all the row knows (no words, no names). AUD31-14: "sent the last
 * message" was cut at 375 ("The seller sent the l…"); the short words fit, and the line may take a second line.
 */
export function orderTalkRowLine(row: Pick<OrderTalkListRow, "side" | "last_mine">): string {
  if (row.last_mine) return t("msg.ot.youLast");
  return row.side === "buyer" ? t("msg.ot.sellerLast") : t("msg.ot.buyerLast");
}

/** The row's name: the order's first item, or "Your order" once that item is gone. Search matches on this too. */
export function orderTalkRowTitle(row: Pick<OrderTalkListRow, "title">): string {
  return row.title ?? t("msg.ot.yourOrder");
}

/** Audit 1122 #138: where the order stands, on the row's second line like a job row's status chip (none when unknown). */
const STAGE_KEY = { paid: "msg.ot.stage.paid", handed_over: "msg.ot.stage.handed_over", refunded: "msg.ot.stage.refunded" } as const;
export function orderTalkStageWords(row: Pick<OrderTalkListRow, "stage" | "open">): string | null {
  if (!row.open || !row.stage) return null; // an ended chat says Ended instead
  const key = STAGE_KEY[row.stage as keyof typeof STAGE_KEY];
  return key ? t(key) : null;
}

/** One order chat as an inbox row; tapping it opens that order's chat sheet (?order_talk=<order id>) over Messages. */
export function OrderTalkRow({ row }: { row: OrderTalkListRow }) {
  const [params, setParams] = useSearchParams();
  const openTalk = (orderId: string) => {
    const next = new URLSearchParams(params);
    next.set("order_talk", orderId);
    setParams(next);
  };
  const photo = orderTalkPhotoUrl(row);
  const stage = orderTalkStageWords(row);
  return (
    <ListRow className={`${CONVERSATION_ROW_FRAME} justify-start`}
      onClick={() => openTalk(row.order_id)} data-order-talk-row={row.order_id}>
      {/* F422 (owner 11-11): title first with its photo, like a job row; the sofa only when the item has no photo. */}
      {photo ? (
        <OptimizedImage data-order-talk-photo="" src={photo} width={44} height={44} alt="" fadeIn
          className={`${CONVERSATION_ROW_AVATAR} shrink-0 rounded-ds-md object-cover bg-muted`} />
      ) : (
        <span className={`${CONVERSATION_ROW_AVATAR} shrink-0 rounded-full inline-flex items-center justify-center bg-muted text-muted-foreground`}
          aria-hidden="true">
          <Sofa className="w-5 h-5" />
        </span>
      )}
      {/* Audit 1122 #138: the job row's unread mark, on the photo's corner. */}
      {row.unread && <span className="relative -ml-3 -mt-9 h-2.5 w-2.5 shrink-0 self-start rounded-full" style={UNREAD_MARK} role="status" aria-label={t("msg.ot.unread")} data-order-talk-unread="" />}
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className={`font-sans ${row.unread ? "font-bold" : "font-semibold"} truncate min-w-0 grow text-ds-15`} title={orderTalkRowTitle(row)}>{orderTalkRowTitle(row)}</span>
          <span className="ml-auto shrink-0 text-ds-11 text-muted-foreground whitespace-nowrap">{rowAge(row.last_at)}</span>
        </span>
        <span className="block text-ds-12 text-muted-foreground line-clamp-2 [overflow-wrap:anywhere]" data-order-talk-line=""
          title={`${row.side !== "buyer" ? t("msg.ot.sold") : t("msg.ot.bought")} · ${orderTalkRowLine(row)}`}>
          {/* Design audit 11-17 #6: "Ended" rides this second line (as a job row's status chip does), so the title
              keeps the whole first line instead of truncating at ~12 characters. */}
          {stage && <span className="mr-1.5 inline-block align-middle text-ds-11 font-semibold px-1.5 py-0.5 rounded-full" style={{ color: MESSAGE_STATUS_CHIP.text, background: MESSAGE_STATUS_CHIP.bg }} data-order-talk-stage={row.stage}>{stage}</span>}
          {!row.open && <span className="mr-1.5 inline-block align-middle text-ds-11 font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground" data-order-talk-ended="">{t("msg.ot.ended")}</span>}
          {row.side === "buyer" ? t("msg.ot.bought") : t("msg.ot.sold")} · {orderTalkRowLine(row)}
        </span>
      </span>
    </ListRow>
  );
}

/** The order-chat query failed: say so above the threads (they still load on their own) and offer a retry. */
export function OrderTalkLoadError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="px-3 py-3">
      <ErrorState variant="inline" title={t("msg.ot.loadFailed")} body={declutterErrorMessage(error)} onRetry={retry} />
    </div>
  );
}
