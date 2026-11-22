import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Gift, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GIFT_PROMO_KEY, giftPromoClosedBefore, giftPromoOver } from "./giftGuidesPromoGate";


/** The promo's words (owner 11-21: "remove picked by a Louisiana nurse"). */
const GIFT_PROMO_TITLE = "Holiday Gift Guides";
const GIFT_PROMO_LINE = "Gifts, deals and codes";
/** Home's strip height: two short lines on a phone, one line from sm (Home holds the same slot while it loads). */
const GIFT_STRIP_HEIGHT = "h-14 sm:h-12";

/**
 * The in-app way to the Holiday Gift Guides, owner mockup option A (claude.ai/artifact/SACKyXWeZ5CnCv4RHAKf1U), a
 * banner a member can close. Closed once, it stays closed on this device; after Dec 25 it draws nothing
 * (giftGuidesPromoGate.ts). The desktop avatar menu carries the menu link (DesktopTopNav).
 *
 * Home (owner 11-21: "move this to under good evening lexi like one long strip"): ONE slim full-width strip right under
 * the greeting (phone: the top of the page), gift icon, the words, a chevron, and the X; Home holds its slot while this
 * chunk loads. Declutter keeps the card, LAST in its Browse list after the end card, so nothing below it moves.
 * Guard: src/test/giftGuidesPromo.test.tsx.
 */
export default function GiftGuidesPromo({ where, now = new Date() }: { where: "home" | "declutter"; now?: Date }) {
  const [closed, setClosed] = useState(giftPromoClosedBefore);
  if (closed || giftPromoOver(now)) return null;
  const close = () => {
    setClosed(true);
    try {
      window.localStorage.setItem(GIFT_PROMO_KEY, "1");
    } catch {
      // storage blocked: closed for this visit only, which is all the member asked for here
    }
  };
  const closeButton = (
    <Button
      type="button"
      variant="ghost"
      size="iconCompact"
      onClick={close}
      aria-label="Close the gift guides banner"
      data-gift-promo-close=""
      className="relative z-10 shrink-0 ctl-exit"
      style={{ color: "#9a7b74" }}
    >
      <X className="h-4 w-4" aria-hidden />
    </Button>
  );
  if (where === "home") {
    return (
      <aside
        aria-label={GIFT_PROMO_TITLE}
        data-gift-promo={where}
        data-gift-promo-strip=""
        className={`relative flex ${GIFT_STRIP_HEIGHT} items-center gap-2.5 rounded-2xl border pl-3.5 pr-0.5`}
        style={{ background: "#f6e6e3", borderColor: "#edd3cd", color: "#3a2a26" }}
      >
        <Gift className="h-5 w-5 shrink-0" style={{ color: "#b26862" }} aria-hidden />
        <Link to="/gift-guides" className="flex min-w-0 flex-1 items-center gap-1.5 after:absolute after:inset-0 after:rounded-[inherit]" data-gift-promo-link="">
          {/* At 375 the words did not fit one line ("Gifts, deals..." cut): two short lines on a phone, one from sm. */}
          <span className="min-w-0 text-ds-14 leading-tight">
            <span className="block truncate font-bold sm:inline">{GIFT_PROMO_TITLE}</span>
            <span aria-hidden className="hidden sm:inline" style={{ color: "#6b5048" }}> · </span>
            <span className="block truncate text-ds-13 sm:inline sm:text-ds-14" style={{ color: "#6b5048" }}>{GIFT_PROMO_LINE}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "#9a7b74" }} aria-hidden />
        </Link>
        {closeButton}
      </aside>
    );
  }
  return (
    <aside
      aria-label={GIFT_PROMO_TITLE}
      data-gift-promo={where}
      className="relative flex items-center gap-3 rounded-2xl border p-3"
      style={{ background: "#f6e6e3", borderColor: "#edd3cd", color: "#3a2a26" }}
    >
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: "#b26862", color: "#fff" }}>
        <Gift className="h-5 w-5" />
      </span>
      <Link to="/gift-guides" className="min-w-0 flex-1 after:absolute after:inset-0 after:rounded-[inherit]" data-gift-promo-link="">
        <span className="block text-ds-15 font-bold">{GIFT_PROMO_TITLE}</span>
        <span className="block text-ds-13" style={{ color: "#6b5048" }}>{GIFT_PROMO_LINE}</span>
      </Link>
      {closeButton}
    </aside>
  );
}
