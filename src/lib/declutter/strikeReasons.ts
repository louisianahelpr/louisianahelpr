/**
 * Deep audit 11-22 #40: the strikes line said "You have 1 of 3 strikes." with no reason. Each reason a strike can carry
 * (public.declutter_strikes.reason, the newest declutter_strikes_reason_check), worded in enDeclSell / esDeclSell as
 * `dsl.strike.r.<reason>`. Guard: src/test/declutterStrikeWhy.test.tsx (every reason the constraint allows has words).
 */
import { t } from "@/lib/i18n/language";
import "@/lib/i18n/enDeclSell";

export const STRIKE_REASONS = [
  "missed_checkout", "not_picked_up", "seller_no_show", "item_gone_after_sale", "cancelled_after_offers", "not_as_described",
  "fake_offer", "false_report",
] as const;

export const strikeReasonWords = (reason: string) =>
  t((STRIKE_REASONS as readonly string[]).includes(reason) ? `dsl.strike.r.${reason}` : "dsl.strike.r.other");
