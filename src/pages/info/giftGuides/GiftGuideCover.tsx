import type { ReactNode } from "react";
import type { CatalogGuide } from "@/content/giftGuideCatalog";

/**
 * A guide's square cover: the owner's own (her ShopMy-style gingham covers with the cream arch,
 * public/gift-guides/covers/<name>.webp, 480x480, lazy and sized) when there is one; else a plain gingham tile in the
 * guide's palette with its name in a cream arch (owner 2026-11-18: no footer text, nothing else drawn on it).
 */
export function GiftGuideCover({ guide }: { guide: CatalogGuide }) {
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
 * Every page's header (owner 2026-11-18, compact): the italic lead, the title and a small Share pill, centred on white
 * over a thin rule. No subtitle and no count under the title (owner 2026-11-18: "remove every 25 picks count and every
 * subtitle").
 */
export function GiftGuidesWords({ lead, title, titleId, share }: { lead: string; title: string; titleId: string; share: ReactNode }) {
  return (
    <header className="gg-words" data-gift-words="">
      <p className="gg-lead">{lead}</p>
      <h2 id={titleId}>{title}</h2>
      {share}
    </header>
  );
}
