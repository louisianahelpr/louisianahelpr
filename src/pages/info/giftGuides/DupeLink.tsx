import { useEffect, useRef, useState } from "react";
import { DUPE, type GuideDupe } from "@/content/giftGuideDupes";
import { Button } from "@/components/ui/button";
import { loadModule, untilReload } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";

type PanelModule = typeof import("./DupePanel");
const loadPanel = () => loadModule(() => import("./DupePanel"));

/**
 * The plain words "shop similar" left of a pick's cart (owner 2026-11-23: "add the word dupe to the left of the cart, no
 * circle around it", then ~3:25 PM "actually just do shop similar instead of dupe"; a pick with no cart has them in the
 * cart's place, left of the heart). A 44px-tall button with no circle, border or fill, in the card's small text, on one
 * line; a tap opens the panel (DupePanel, its own chunk loaded on the first tap). Only a pick carrying similar items
 * (CatalogPick.dupes, src/content/giftGuideDupes.ts) draws one. Guard: src/test/giftGuideDupes1123.test.tsx.
 */
/** `of`: the original pick's name (the panel's label). `solo`: the pick has no cart, so the words take the cart's place. */
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
  return (
    <>
      {/* The shared Button (OWN-SHARED), its look set by .gg-dupe: plain words, no circle, border or fill. */}
      <Button
        ref={word} type="button" variant="ghost" size="sm" className={solo ? "gg-dupe gg-dupe-solo" : "gg-dupe"} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} data-gift-dupe=""
      >
        {/* The visible words start the name (WCAG 2.5.3, axe label-content-name-mismatch): "shop similar: 3 similar items". */}
        {DUPE.word}
        <span className="sr-only" data-gift-dupe-sr="">{`: ${DUPE.count(dupes.length)}`}</span>
      </Button>
      {Panel && <Panel dupes={dupes} of={of} open={open} onClose={() => setOpen(false)} anchor={word} />}
    </>
  );
}
