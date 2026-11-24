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
 * A guides page's banner, drawn by GuidesTop (src/pages/info/giftGuides/GuidesTop.tsx) on every guides page but the
 * landing (owner 2026-11-22 #13: "gifts tags and all the other sections should have the same top section as the guides
 * and the deals"). The title is the page's h1 (live audit r3 #7: "Gifts for Her", not the head row's "Holiday gift
 * guides", a plain line). No subtitle and no count under the title (owner 2026-11-18: "remove every 25 picks count and
 * every subtitle").
 *
 * A short, wide banner in a guide cover's look (owner 2026-11-18 PM: "make the top ... like the gifts for mom that kind
 * of matches the cover photo"): the gingham in `tint`, a cream arch holding the lead and the title (owner 11-21: "remove
 * louisiana helpr from the [banner]"). Real text and CSS only (no image); a fixed height, so nothing below moves.
 * `sub`: a page that is not a guide or a deals day (the printables, the fun pages, the wish lists, the Holiday Hub), its
 * title in the deals days' sizes. Guard: src/test/giftGuidesPage.test.tsx, src/test/giftGuidePages1122.test.tsx.
 * A long title wraps, never clips (lead 11-24: "KPop Demon Hunters Gif…" at 375, the theme guides' second line cut at
 * 1440): the band's heights are minimums, and a long title takes smaller type (bannerLength). Guard:
 * src/test/guideBannerLongTitle1124.test.tsx.
 */
/** "long" (over 12 letters: the deal days' sizes from 768px) or "xlong" (over 24: smaller on a phone too), else "". */
export function bannerLength(title: string): "" | "long" | "xlong" {
  return title.length > 24 ? "xlong" : title.length > 12 ? "long" : "";
}

export function GiftGuidesWords({ lead, title, titleId, tint, sub = false }: { lead: string; title: string; titleId: string; tint: CatalogGuide["tint"]; sub?: boolean }) {
  const size = bannerLength(title);
  const sizeClass = size === "xlong" ? " gg-banner-long gg-banner-xlong" : size === "long" ? " gg-banner-long" : "";
  return (
    <header className={(sub ? "gg-words gg-banner-wrap gg-banner-sub" : "gg-words gg-banner-wrap") + sizeClass} data-gift-words="" data-gift-banner={tint}>
      <div className={`gg-banner gg-check gg-${tint}`}>
        <div className="gg-arch" data-gift-arch="">
          {/* Holiday audit 1121: the h1 itself reads "gifts for Her" (it was just "Her" for screen readers and search);
              the italic lead above stays as drawn and is hidden from screen readers, so it is not read twice. */}
          <p className="gg-lead" aria-hidden="true">{lead}</p>
          <h1 id={titleId}><span className="sr-only">{lead}</span>{" "}{title}</h1>
        </div>
      </div>
    </header>
  );
}
