import { useState } from "react";
import { Link } from "react-router-dom";
import { Gift, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The in-app way to the Holiday Gift Guides, owner mockup option A (claude.ai/artifact/SACKyXWeZ5CnCv4RHAKf1U): a pink
 * banner a member can close, on Home and Declutter. It loads on its own (lazy) and sits LAST in its column (Home's side
 * column, Declutter's Browse list after the end card), so nothing below it moves when it arrives and index.html's
 * first-screen copies of /home and /declutter stay true. Closed once, it stays closed on this device; after Dec 25 it
 * draws nothing. The desktop avatar menu carries the menu link (DesktopTopNav). Guard: src/test/giftGuidesPromo.test.tsx.
 */
export const GIFT_PROMO_KEY = "lh-gift-guides-promo-closed";
/** The last day the banner shows (YYYY-MM-DD, local). */
const GIFT_PROMO_LAST_DAY = "2026-12-25";

const todayIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function closedBefore(): boolean {
  try {
    return window.localStorage.getItem(GIFT_PROMO_KEY) === "1";
  } catch {
    return false; // storage blocked (private window): the banner shows; closing still hides it for this visit
  }
}

export default function GiftGuidesPromo({ where, now = new Date() }: { where: "home" | "declutter"; now?: Date }) {
  const [closed, setClosed] = useState(closedBefore);
  if (closed || todayIso(now) > GIFT_PROMO_LAST_DAY) return null;
  const close = () => {
    setClosed(true);
    try {
      window.localStorage.setItem(GIFT_PROMO_KEY, "1");
    } catch {
      // storage blocked: closed for this visit only, which is all the member asked for here
    }
  };
  return (
    <aside
      aria-label="Holiday Gift Guides"
      data-gift-promo={where}
      className="relative flex items-center gap-3 rounded-2xl border p-3"
      style={{ background: "#f6e6e3", borderColor: "#edd3cd", color: "#3a2a26" }}
    >
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: "#b26862", color: "#fff" }}>
        <Gift className="h-5 w-5" />
      </span>
      <Link to="/gift-guides" className="min-w-0 flex-1 after:absolute after:inset-0 after:rounded-[inherit]" data-gift-promo-link="">
        <span className="block text-ds-15 font-bold">Holiday Gift Guides</span>
        <span className="block text-ds-13" style={{ color: "#6b5048" }}>Gifts, deals and codes, picked by a Louisiana nurse</span>
      </Link>
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
    </aside>
  );
}
