/**
 * Q2106 S5: the buyer's own gift cards at Declutter checkout (the jobs shape: usePostJobGiftCard + GiftCardTeaser).
 *
 * Only gifts the server would take are offered: claimed by this buyer (recipient_id), funded, sent/available and
 * unexpired (useSpendableGiftCards, the redeem gate; no new read rights). The split is shown before Pay, from the same
 * total the Pay button carries: "$X from your gift card, $Y on your card", or "Your gift card covers it all".
 * redeem_gift_card_for_declutter_order refuses a card remainder under $0.50 (Stripe's floor), so the screen says so
 * first and Pay waits for another choice. Any refusal the server still sends (expired meanwhile, set aside for another
 * order, not funded) is shown here in its own words, never as "Something went wrong".
 */
import type { SpendableGift } from "@/hooks/useSpendableGiftCards";
import { formatPrice } from "@/lib/declutter/distance";
import { formatShortDate } from "@/lib/format";
import { RadioCardList } from "@/components/ui/RadioCardList";

/** Stripe's smallest card charge (USD), the server's floor for what is left after a gift. */
const CARD_MINIMUM_CENTS = 50;

export interface GiftSplit {
  /** What the gift card pays. */
  fromGiftCents: number;
  /** What goes on the card (0 = the gift covers it all, no card page). */
  onCardCents: number;
  /** What stays on the gift card for later. */
  leftOnGiftCents: number;
  /** A card part above 0 but under $0.50: the server refuses it. */
  cardPartTooSmall: boolean;
}

/** The redeem's own arithmetic (20261105030604): applied = least(cost, gift); the card pays the difference. */
export function giftSplit(payCents: number, giftCents: number): GiftSplit {
  const fromGiftCents = Math.max(0, Math.min(payCents, giftCents));
  const onCardCents = Math.max(0, payCents - fromGiftCents);
  return {
    fromGiftCents,
    onCardCents,
    leftOnGiftCents: Math.max(0, giftCents - fromGiftCents),
    cardPartTooSmall: onCardCents > 0 && onCardCents < CARD_MINIMUM_CENTS,
  };
}

/** The gifts this buyer can spend here: claimed by them, with something on them. */
export function giftsForCheckout(cards: SpendableGift[], now = Date.now()): SpendableGift[] {
  // The read already drops expired gifts; checked again here so a gift that expired while the screen sat open is
  // never offered (the redeem refuses it: "This gift has expired").
  return cards.filter((c) => c.claimed && c.amountCents > 0 && (!c.expiresAt || new Date(c.expiresAt).getTime() > now));
}

/** A refusal about the gift itself (not "a card payment is already open"): the gift is marked unavailable here. */
export function refusalRetiresGift(words: string): boolean {
  return !words.startsWith("A card payment for this order is already open");
}

/**
 * The redeem's refusals, written for the buyer (P0001 / 42501 / PT404 in redeem_gift_card_for_declutter_order;
 * declutter-checkout passes the sentence through as its error). Anything else is not a gift refusal: null.
 */
const GIFT_REFUSALS: RegExp[] = [
  /^This gift has expired$/,
  /^This gift is set aside for something else$/,
  /^This gift has not been funded yet$/,
  /^This gift is no longer available$/,
  /^This gift has nothing left to spend$/,
  /^This gift is not yours to redeem$/,
  /^Gift not found$/,
  /^Your gift covers all but \$\d+\.\d{2} of this order, and a card payment has to be at least \$0\.50\./,
  /^A card payment for this order is already open\. Finish it or wait a moment, then use the gift\.$/,
];

export function giftPayErrorMessage(err: unknown): string | null {
  const message = typeof (err as { message?: unknown } | null)?.message === "string" ? (err as { message: string }).message.trim() : "";
  if (!message || !GIFT_REFUSALS.some((re) => re.test(message))) return null;
  // Two refusals name no next step: give the buyer one.
  if (message === "Gift not found" || message === "This gift is not yours to redeem") return "This gift card can't be used here. Choose another, or pay by card.";
  return message;
}

/** The split in one sentence, from the total the Pay button carries (null total: not complete yet). */
export function giftSplitWords(split: GiftSplit | null): string {
  if (!split) return "Your gift card pays first. What's left goes on your card.";
  if (split.cardPartTooSmall) {
    return `Your gift card covers all but ${formatPrice(split.onCardCents)}, and a card payment has to be at least ${formatPrice(CARD_MINIMUM_CENTS)}. Choose another gift card, or pay by card.`;
  }
  const kept = split.leftOnGiftCents > 0 ? ` The ${formatPrice(split.leftOnGiftCents)} left on it stays yours.` : "";
  if (split.onCardCents === 0) return `Your gift card covers it all.${kept}`;
  return `${formatPrice(split.fromGiftCents)} from your gift card, ${formatPrice(split.onCardCents)} on your card.${kept}`;
}

export function DeclutterGiftPicker({ gifts, refused = {}, value, onChange, split, error }: {
  /** giftsForCheckout(...): the picker is not drawn without one. */
  gifts: SpendableGift[];
  /** Gifts the server refused in this checkout, with its words: shown unavailable, never picked again. */
  refused?: Record<string, string>;
  /** The picked gift's id, or null to pay by card only. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** giftSplit for the picked gift, or null while the total is not complete. */
  split: GiftSplit | null;
  /** A refusal from the server (giftPayErrorMessage), shown under the choice. */
  error: string | null;
}) {
  if (gifts.length === 0 && !error) return null;
  const usable = gifts.filter((g) => !(g.id in refused));
  const retired = gifts.filter((g) => g.id in refused);
  // RadioCardList's values are strings: "" is "Pay by card only".
  const options = [
    ...usable.map((g) => ({ value: g.id, label: `Use my ${formatPrice(g.amountCents)} gift card`,
      sub: g.expiresAt ? `Use by ${formatShortDate(g.expiresAt)}` : undefined })),
    { value: "", label: "Pay by card only" },
  ];
  return (
    <div className="space-y-2" data-gift-picker="">
      <p className="mb-2 text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground" aria-hidden="true">Gift card</p>
      <RadioCardList label="Gift card" options={options} value={value ?? ""} onChange={(v) => onChange(v === "" ? null : v)} />
      {retired.map((g) => (
        <div key={g.id} aria-disabled="true" className="rounded-2xl border border-border px-4 py-3" data-gift-unavailable={g.id}>
          <p className="text-ds-15 font-semibold text-muted-foreground">Your {formatPrice(g.amountCents)} gift card can't be used here</p>
          <p className="text-ds-13 text-muted-foreground">{refused[g.id]}</p>
        </div>
      ))}
      {value !== null && (
        <p className={`text-ds-14 ${split?.cardPartTooSmall ? "font-semibold text-foreground" : "text-muted-foreground"}`} aria-live="polite" data-gift-split="">
          {giftSplitWords(split)}
        </p>
      )}
      {error && <p role="alert" className="text-ds-14 font-semibold text-destructive-ink" data-gift-error="">{error}</p>}
    </div>
  );
}
