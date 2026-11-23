import type { CSSProperties, RefObject } from "react";
import { X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { DUPE, type GuideDupe } from "@/content/giftGuideDupes";
import type { CatalogPick } from "@/content/giftGuideCatalog";
import { PricesAsOf } from "@/components/giftGuides/PickPrice";
import { PickRow } from "./GiftGuideView";

/**
 * The dupe panel (owner 2026-11-23: "only when they click dupe next to the cart will it show"; ~1:50 PM "the page will
 * have the dupes listed like the other items when they click dupe if there is more than one ... list the dupes the same
 * way the other layout is for the guides"): the pick's dupes, one or many, as the guide's own rows (PickRow in a
 * .gg-list: the photo, the name, ~price, the heart, and an Amazon pick's cart; the row opens our Amazon tag link in a new
 * tab, sponsored + noopener, through GiftOut), with the list's one "Prices as of" line. The app's own patterns: the
 * shared bottom Sheet on a phone (the phone's rows), a Popover beside the "dupe" word on a tablet or computer (the
 * computer's cards, one column per dupe up to three). Closes with its X, Escape or a tap outside, and gives focus back to
 * the "dupe" word. Its own chunk, loaded on the first tap (DupeLink). Guard: src/test/giftGuideDupes1123.test.tsx.
 */

/** A dupe drawn as a guide pick: an Amazon item with its checked price and photo. */
const asPick = (d: GuideDupe): CatalogPick => ({ name: d.name, href: d.href, store: "amazon", price: d.price, priceAt: d.priceAt, ...(d.image ? { image: d.image } : {}) });

export function DupePanel({ dupes, of, open, onClose, anchor }: { dupes: GuideDupe[]; of: string; open: boolean; onClose: () => void; anchor: RefObject<HTMLButtonElement> }) {
  const phone = useIsMobile();
  const picks = dupes.map(asPick);
  const backToWord = (e: Event) => {
    e.preventDefault();
    anchor.current?.focus();
  };
  const list = (
    <>
      <ol className="gg-list gg-dupe-list" data-gift-dupe-list="">
        {picks.map((p) => <PickRow key={p.href} pick={p} />)}
      </ol>
      <PricesAsOf picks={picks} />
    </>
  );
  if (phone) {
    return (
      <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent side="bottom" className="gg gg-dupe-panel gg-dupe-sheet" data-gift-dupe-panel="" aria-describedby={undefined} onCloseAutoFocus={backToWord}>
          <SheetHero title={DUPE.title(dupes)} />
          {list}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <PopoverAnchor virtualRef={anchor as RefObject<HTMLButtonElement>} />
      <PopoverContent
        className="gg gg-dupe-panel gg-dupe-pop" role="dialog" aria-label={DUPE.panelLabel(dupes, of)} data-gift-dupe-panel="" side="bottom" align="end"
        style={{ "--gg-dupe-cols": Math.min(dupes.length, 3) } as CSSProperties}
        onCloseAutoFocus={backToWord}
        // The "dupe" word is the anchor, not a Radix trigger: a press on it is "outside", and must not close the panel
        // only for the same click to open it again.
        onInteractOutside={(e) => { if (anchor.current?.contains(e.target as Node)) e.preventDefault(); }}
      >
        <button type="button" className="gg-dupe-x" aria-label={DUPE.close} onClick={onClose} data-gift-dupe-close="">
          <X aria-hidden="true" />
        </button>
        <p className="gg-dupe-note">{DUPE.title(dupes)}</p>
        {list}
      </PopoverContent>
    </Popover>
  );
}
