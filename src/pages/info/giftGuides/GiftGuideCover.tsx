import type { ReactNode } from "react";
import type { CatalogGuide } from "@/content/giftGuideCatalog";

/**
 * A guide's square cover: the owner's own (her ShopMy-style gingham covers with the cream arch,
 * public/gift-guides/covers/<name>.webp, 480x480, lazy and sized) when there is one; else a plain gingham tile in the
 * guide's palette with its name in a cream arch (owner 2026-11-18: no footer text, nothing else drawn on it).
 */
export function GiftGuideCover({ guide, priority = false }: { guide: CatalogGuide; priority?: boolean }) {
  // Holistic review 11-18 M10 (3.0-3.5 s on 4G): the landing's first four covers load at once, ahead of the rest.
  if (guide.cover && priority) {
    return <img className="gg-cover" loading="eager" decoding="async" {...{ fetchpriority: "high" }} src={guide.cover} alt="" width={480} height={480} data-gift-cover="" data-gift-cover-priority="" />;
  }
  if (guide.cover) {
    return <img className="gg-cover" loading="lazy" decoding="async" src={guide.cover} alt="" width={480} height={480} data-gift-cover="" />;
  }
  return (
    <span className={`gg-cover gg-check gg-textcover gg-${guide.tint}`} aria-hidden="true" data-gift-textcover="">
      <strong>{guide.title}</strong>
    </span>
  );
}

/**
 * Every page's header (owner 2026-11-18, compact): the italic lead, the title and the slim tool row (search, My list,
 * Share; owner redesign 11-18 PM), centred on white over a thin rule. The title is the page's h1 (live audit r3 #7:
 * "Gifts for Her", not the header's "Gift guides", which PublicHeaderPage paints as a plain line). No subtitle and no count under the title (owner 2026-11-18: "remove every 25 picks count and every
 * subtitle").
 *
 * A guide's page (with `tint`) draws it as a short, wide banner in its cover's look (owner 2026-11-18 PM: "make the top
 * ... like the gifts for mom that kind of matches the cover photo"): the guide's gingham, a cream arch holding the
 * lead and the title (owner 11-21: "remove louisiana helpr from the [banner]"), Share right under it. Real text and CSS only (no image); a
 * fixed height, so nothing below moves. Guard: src/test/giftGuidesPage.test.tsx.
 */
export function GiftGuidesWords({ lead, title, titleId, tools, tint }: { lead: string; title: string; titleId: string; tools: ReactNode; tint?: CatalogGuide["tint"] }) {
  if (tint) {
    return (
      <header className="gg-words gg-banner-wrap" data-gift-words="" data-gift-banner={tint}>
        <div className={`gg-banner gg-check gg-${tint}`}>
          <div className="gg-arch" data-gift-arch="">
            <p className="gg-lead">{lead}</p>
            <h1 id={titleId}>{title}</h1>
          </div>
        </div>
        {tools}
      </header>
    );
  }
  return (
    <header className="gg-words" data-gift-words="">
      {lead && <p className="gg-lead">{lead}</p>}
      <h1 id={titleId}>{title}</h1>
      {tools}
    </header>
  );
}
