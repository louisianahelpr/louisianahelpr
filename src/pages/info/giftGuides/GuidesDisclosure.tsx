import { useEffect, useState, type RefObject } from "react";
import { giftGuides as G } from "@/content/giftGuides";

/**
 * An affiliate link on a gift guides page: every outbound shop link is drawn by GiftOut (data-gift-out, rel sponsored),
 * and any other sponsored link counts too.
 */
const AFFILIATE_LINK = "a[data-gift-out], a[rel~='sponsored']";

/**
 * Whether the page under `scope` shows at least one affiliate link, kept current as the page changes (a guide's picks
 * load after the page, Swipe deals new cards, the planner adds a saved gift). A passive effect, not a layout one: the
 * scope is an ancestor, and React attaches an ancestor's ref only after its children's layout effects have run.
 */
function useHasAffiliateLink(scope: RefObject<HTMLElement | null>) {
  const [has, setHas] = useState(false);
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const check = () => setHas(root.querySelector(AFFILIATE_LINK) !== null);
    check();
    if (typeof MutationObserver === "undefined") return;
    const watch = new MutationObserver(check);
    watch.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["rel", "data-gift-out"] });
    return () => watch.disconnect();
  }, [scope]);
  return has;
}

/**
 * The one small muted line at the foot of a gift guides page: the FTC disclosure (16 CFR Part 255) holding the statement
 * the Amazon Associates agreement requires (one line, owner 11-22). Owner 2026-11-22 ("remove affiliate link stuff from
 * where it does not belong"; "this doesnt need to show on any of the free printable sections"): it shows only while the
 * page carries an affiliate link, so a page with none (the printables, Secret Santa, the Holiday Hub, an empty planner)
 * never shows it, and a page that gains one (a quiz answer, a saved gift) shows it at once.
 * Guard: src/test/giftGuideDisclosureWhereLinked1122.test.tsx.
 */
export function GuidesDisclosure({ scope, ...data }: { scope: RefObject<HTMLElement | null> } & Record<`data-${string}`, string>) {
  const linked = useHasAffiliateLink(scope);
  if (!linked) return null;
  return (
    <footer className="gg-disc" data-gift-disclosure-footer="" {...data}>
      <p data-gift-disclosure="">{G.disclosureLead} <span data-gift-amazon-statement="">{G.amazonStatement}</span></p>
    </footer>
  );
}
