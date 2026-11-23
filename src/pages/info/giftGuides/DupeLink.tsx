import { useEffect, useRef, useState } from "react";
import { DUPE, type GuideDupe } from "@/content/giftGuideDupes";
import { showsPrice } from "@/components/giftGuides/PickPrice";
import { giftGuides as G } from "@/content/giftGuides";
import { shownDollars } from "@/lib/pickPriceShown.mjs";
import { loadModule, untilReload } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";

type PanelModule = typeof import("./DupePanel");
const loadPanel = () => loadModule(() => import("./DupePanel"));

/**
 * The plain word "dupe" left of a pick's cart (owner 2026-11-23: "add the word dupe to the left of the cart, no circle
 * around it"; a pick with no cart has it in the cart's place, left of the heart). A 44px button with no circle, border
 * or fill, in the card's small text; a tap opens the dupe panel (DupePanel, its own chunk loaded on the first tap). Only
 * a pick carrying dupes (CatalogPick.dupes, src/content/giftGuideDupes.ts) draws one. Guard: src/test/giftGuideDupes1123.test.tsx.
 */
/** `of`: the original pick's name (the panel's label). `solo`: the pick has no cart, so the word takes the cart's place. */
export function DupeLink({ dupes, of, solo = false }: { dupes: GuideDupe[]; of: string; solo?: boolean }) {
  const [open, setOpen] = useState(false);
  const word = useRef<HTMLButtonElement>(null);
  const [Panel, setPanel] = useState<PanelModule["DupePanel"] | null>(null);
  useEffect(() => {
    if (!open || Panel) return;
    let live = true;
    void loadPanel()
      .then((m) => m ?? untilReload())
      .then(
        (m) => { if (live) setPanel(() => m.DupePanel); },
        (e) => report(e as Error, { tags: { source: "DupeLink.loadPanel" } }),
      );
    return () => {
      live = false;
    };
  }, [open, Panel]);
  const one = dupes[0];
  const price = dupes.length === 1 && showsPrice({ name: one.name, href: one.href, store: "amazon", price: one.price, priceAt: one.priceAt }) ? G.priceApprox(shownDollars(one.price)) : undefined;
  return (
    <>
      <button
        ref={word} type="button" className={solo ? "gg-dupe gg-dupe-solo" : "gg-dupe"} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} data-gift-dupe=""
      >
        {/* The visible word starts the name (WCAG 2.5.3, axe label-content-name-mismatch): "dupe, Cheaper lookalike: <name>, ~$50" (several: "dupe, 3 cheaper lookalikes"). */}
        {DUPE.word}
        <span className="sr-only" data-gift-dupe-sr="">{`, ${DUPE.label(dupes, price)}`}</span>
      </button>
      {Panel && <Panel dupes={dupes} of={of} open={open} onClose={() => setOpen(false)} anchor={word} />}
    </>
  );
}
