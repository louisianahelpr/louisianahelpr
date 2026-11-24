import type { OrderTalkListRow } from "./orderTalk";

/** The order chats the caller has not read yet (audit 1122 #138). A row from before 20261124192812 has no `unread`
 *  field and reads as read. Its own module, so the many tests that mock orderTalk.ts need not know about it. */
export function unreadOrderTalks<T extends Pick<OrderTalkListRow, "unread">>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.unread === true);
}
