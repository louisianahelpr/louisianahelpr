import { giftGuides as G } from "@/content/giftGuides";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import { useHint } from "./GiftHint";
import { openGuidesMenu } from "./GiftGuidesPhoneNav";

/** The tip's id in GiftHint's store: closed once, it stays closed on every guides page ("lh-gg-hint-menu"). */
const MENU_HINT_ID = "menu";

/** The guides that open with the tip (the three live guides, owner 11-21). */
export const MENU_HINT_GUIDES: ReadonlySet<string> = new Set(["her", "him", "kids"]);

const W = G.menuHint;

/**
 * The one-line menu tip (owner 2026-11-22, 11:40 PM: visitors don't find the free printables, deals and the Holiday Hub,
 * "they don't even know what to do or look for"; the longer lists were "way too busy"): a slim cream box (38px; "not as big as the mockup"), "Tap [the
 * three-line icon] for deals, free printables & more", and a Close on the right. Tapping the words opens the guides menu,
 * exactly as the head row's three-line icon does (openGuidesMenu). Close hides it and remembers that in localStorage
 * (GiftHint's try/catch store), so it stays closed on every guides page after.
 * On /gift-guides under the greeting and above the covers, and at the top of Her, Him and Kids (Facebook visitors land on
 * Her). Only where the three-line icon shows (up to 767px): from 768px the left menu is always on screen, so the CSS
 * hides it there.
 * Guard: src/test/giftGuideMenuHint1122.test.tsx.
 */
export function GuidesMenuHint() {
  const [showing, close] = useHint(MENU_HINT_ID);
  if (!showing) return null;
  return (
    <div className="gg-menuhint" data-gift-menu-hint="">
      <button type="button" className="gg-menuhint-go" onClick={openGuidesMenu} aria-haspopup="dialog" data-gift-menu-hint-open="">
        <span className="gg-menuhint-t">
          {W.before}{" "}
          <span className="gg-menuhint-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="12" height="12"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE_PX} strokeLinecap="round" /></svg>
          </span>
          <span className="sr-only">{W.icon}</span>{" "}{W.after}
        </span>
      </button>
      <button type="button" className="gg-menuhint-x" onClick={close} aria-label={W.close} data-gift-menu-hint-close="">
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
