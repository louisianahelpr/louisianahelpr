/**
 * Q2110: the member's own Shops strikes and when each ends. Shows nothing while loading, with no strikes, or when
 * the read fails (it is a side note; the screen's own refusal, shop_strikes_blocked, still shows its words). At the
 * limit it says the day Shops opens again: the day the soonest strike ends.
 * Mounted on the shop dashboard (the shop side) and on a shop's order section (the buyer side).
 */
import { useQuery } from "@tanstack/react-query";
import { formatShortDate } from "@/lib/format";
import { fetchMyShopStrikes, SHOP_STRIKE_LIMIT, shopStrikeReasonWords } from "@/lib/shops/strikes";
import { ShopsNotice } from "./shopsUi";

export default function ShopMyStrikes() {
  const strikes = useQuery({ queryKey: ["shops", "my-strikes"], queryFn: fetchMyShopStrikes, staleTime: 60_000, retry: false });
  const rows = strikes.data ?? [];
  if (rows.length === 0) return null;

  const paused = rows.length >= SHOP_STRIKE_LIMIT;
  const title = paused
    ? `Shops is paused for you until ${formatShortDate(rows[0].expires_at)}`
    : `You have ${rows.length} Shops strike${rows.length === 1 ? "" : "s"}`;
  return (
    <div data-testid="shop-my-strikes">
      <ShopsNotice title={title} tone={paused ? "warn" : "info"}>
        <p>
          {paused
            ? `You have ${rows.length} Shops strikes. Shops opens again when the first one ends.`
            : `At ${SHOP_STRIKE_LIMIT} strikes Shops pauses for you until one ends.`}
        </p>
        <ul className="mt-2 space-y-1">
          {rows.map((s) => (
            <li key={s.id}>
              {shopStrikeReasonWords(s.reason)}. Ends {formatShortDate(s.expires_at)}.
            </li>
          ))}
        </ul>
      </ShopsNotice>
    </div>
  );
}
