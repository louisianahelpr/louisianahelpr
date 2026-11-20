import { t } from "@/lib/i18n/language";
import "@/lib/i18n/enPushAsk";
import type { MsgKey } from "@/lib/i18n/en";

/**
 * The notifications ask's words for the action that raised it (owner 2026-11-20, ease batch item 3): "Want a ping
 * when someone applies?" right after posting a job, "...when you're hired?" after applying, "...when someone makes an
 * offer?" after listing, "...when they reply?" after a message. A lazy module, loaded with the ask (useWebPush.ts), so
 * no page's first load carries it. Null for an action without its own words: the sheet keeps its general copy.
 */
export type PushAskContext = "posted" | "applied" | "listed" | "message";
export const PUSH_ASK_CONTEXTS: readonly PushAskContext[] = ["posted", "applied", "listed", "message"];

export function pushAskWords(context: string | null | undefined): { title: string; body: string } | null {
  if (!context || !(PUSH_ASK_CONTEXTS as readonly string[]).includes(context)) return null;
  return { title: t(`pushAsk.${context}.title` as MsgKey), body: t(`pushAsk.${context}.body` as MsgKey) };
}
