import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { Input } from "@/components/ui/input";
import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { SITE_ORIGIN } from "@/lib/publicPageMeta.mjs";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import { giftGuides as G } from "@/content/giftGuides";
import { guideBySlug, loadSearchItems, searchGuides, searchItems, type SearchItem } from "@/content/giftGuideCatalog";
import { MY_LIST_SLUG, useGiftList } from "./giftList";
import { WISH } from "@/content/giftWishList";

/** The share links for a gift-guides page (owner 2026-11-18): Facebook's sharer and Pinterest's pin builder, no SDK script. */
const shareLinks = (path: string, title: string, image?: string) => {
  const url = `${SITE_ORIGIN}${path}`;
  const pin = new URLSearchParams({ url, description: title });
  if (image) pin.set("media", `${SITE_ORIGIN}${image}`);
  return {
    url,
    facebook: `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: url }).toString()}`,
    pinterest: `https://www.pinterest.com/pin/create/button/?${pin.toString()}`,
  };
};

/**
 * "Text this guide" (owner 2026-11-18): an sms: link with the guide's URL in the body. iOS reads `sms:&body=`, Android
 * and the rest `sms:?body=`.
 */
export const smsHref = (url: string, title: string, userAgent: string) =>
  `sms:${/iPhone|iPad|iPod/.test(userAgent) ? "&" : "?"}body=${encodeURIComponent(`${title} ${url}`)}`;

const Icon = ({ d, fill = "none" }: { d: string; fill?: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d={d} fill={fill} stroke="currentColor" strokeWidth={ICON_STROKE_PX} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const HEART = "M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.7 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.5 0 5.8 3.4 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2z";
const SHARE = "M12 15V3.5M7.5 8 12 3.5 16.5 8M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5";

/**
 * Share (owner redesign 11-18 PM: "Text the guides should be under share right?"): one icon; tapping it opens a small
 * menu with Copy link, Text this guide (sms:), the phone's own share sheet where there is one (navigator.share),
 * Facebook and Pinterest. Escape or a tap outside closes it.
 */
function GiftGuideShare({ path, title, image, many = false }: { path: string; title: string; image?: string; many?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const links = shareLinks(path, title, image);
  const url = links.url;
  const native = typeof navigator !== "undefined" && typeof navigator.share === "function";
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const copy = () => {
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      // Clipboard refused: Text and the phone's share sheet still work.
      () => setCopied(false),
    );
  };
  const shareSheet = () => {
    setOpen(false);
    // A cancelled share sheet rejects; nothing to do, the page is unchanged.
    navigator.share({ title, url }).catch(() => setOpen(false));
  };
  return (
    <span ref={wrap} className="gg-share-wrap">
      <RoundIconButton className="gg-icon" aria-label={G.shareLabel} aria-expanded={open} aria-haspopup="menu"
        onClick={() => { setCopied(false); setOpen((o) => !o); }} data-gift-share="">
        <Icon d={SHARE} />
      </RoundIconButton>
      {open && (
        <span className="gg-share-menu" role="menu" aria-label={G.shareMenuLabel} data-gift-share-menu="">
          <InlineTextButton role="menuitem" onClick={copy} data-gift-copy-link="">{copied ? G.linkCopied : G.copyLink}</InlineTextButton>
          <a role="menuitem" href={smsHref(links.url, title, typeof navigator === "undefined" ? "" : navigator.userAgent)} data-gift-text="">{many ? G.textGuides : G.textGuide}</a>
          {native && <InlineTextButton role="menuitem" onClick={shareSheet} data-gift-share-native="">{G.moreShare}</InlineTextButton>}
          <a role="menuitem" href={links.facebook} target="_blank" rel="noopener noreferrer">Facebook</a>
          <a role="menuitem" href={links.pinterest} target="_blank" rel="noopener noreferrer" data-gift-pin="">Pinterest</a>
        </span>
      )}
    </span>
  );
}

/** My Wish List as an icon with its count (a link to /gift-guides/my-list). */
function MyListIcon({ current }: { current: boolean }) {
  const list = useGiftList();
  const n = list.guides.length + list.picks.length;
  return (
    <Link to={`/gift-guides/${MY_LIST_SLUG}`} className="gg-icon gg-mylist-icon" aria-label={WISH.countLabel(n)}
      {...(current ? { "aria-current": "page" as const } : {})} data-gift-my-list-link="">
      <Icon d={HEART} fill={n > 0 ? "currentColor" : "none"} />
      {/* No count badge on an empty list (pre-launch audit 11-18 PM: a red "0"). */}
      {n > 0 && <span className="gg-icon-count" aria-hidden="true" data-gift-my-list-count="">{n}</span>}
    </Link>
  );
}

/**
 * The one slim row under every title (owner redesign 11-18 PM): a search field over every guide, My list (with its
 * count) and Share. Nothing else: no pill buttons, no Codes (a page section now).
 */
export function GiftGuideTools({ path, title, image, many = false, myList = false }: { path: string; title: string; image?: string; many?: boolean; myList?: boolean }) {
  const [query, setQuery] = useState("");
  const found = query.trim() ? searchGuides(query) : [];
  // Holistic review 11-18 H5: product names too ("airpods"), from an index fetched on the first keystroke.
  const [items, setItems] = useState<SearchItem[] | null>(null);
  useEffect(() => {
    if (!query.trim() || items) return;
    let live = true;
    loadSearchItems().then((x) => { if (live) setItems(x); }, (e: unknown) => {
      // Offline or a stale deploy: the guide results still show; item results stay empty.
      console.warn("gift guides: search index failed", e);
    });
    return () => { live = false; };
  }, [query, items]);
  const foundItems = query.trim() && items ? searchItems(items, query) : [];
  return (
    <div className="gg-tools" role="group" aria-label={G.quickLabel} data-gift-quick="">
      <div className="gg-tools-search">
        <label id="gift-search" className="gg-search rounded-full focus-within:ring-2 focus-within:ring-ring">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE_PX} /><path d="M20 20l-4-4" stroke="currentColor" strokeWidth={ICON_STROKE_PX} strokeLinecap="round" /></svg>
          <Input look="bare" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={G.searchPlaceholder} aria-label={G.searchLabel} data-gift-search="" />
        </label>
        {query.trim() && (
          <ul className="gg-search-results" data-gift-search-results="" aria-live="polite">
            {found.length === 0 && foundItems.length === 0 && <li className="gg-search-none">{G.searchNone}</li>}
            {found.length > 0 && foundItems.length > 0 && <li className="gg-search-head" aria-hidden="true">{G.searchGuidesTitle}</li>}
            {found.slice(0, 12).map((g) => (
              <li key={g.slug}>
                <Link to={`/gift-guides/${g.slug}`} onClick={() => setQuery("")} data-gift-found={g.slug}>
                  {/* The guide's cover as a small thumbnail (holistic review 11-18 H5). */}
                  {g.cover ? <img className="gg-search-thumb" loading="lazy" decoding="async" src={g.cover} alt="" width={36} height={36} /> : <span className={`gg-search-thumb gg-check gg-${g.tint}`} aria-hidden="true" />}
                  <span>{g.age ? `${g.title}, ${g.lead.replace(/^gifts for /, "")}` : g.title}</span>
                </Link>
              </li>
            ))}
            {foundItems.length > 0 && <li className="gg-search-head" aria-hidden="true">{G.searchItemsTitle}</li>}
            {foundItems.map(([name, slug]) => (
              <li key={`${slug} ${name}`}>
                <Link to={`/gift-guides/${slug}`} onClick={() => setQuery("")} data-gift-found-item={slug}>
                  <span className="gg-search-item">
                    <span className="gg-search-item-name">{name}</span>
                    <small>{G.searchItemIn(guideBySlug(slug)?.title ?? "")}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <MyListIcon current={myList} />
      <GiftGuideShare path={path} title={title} image={image} many={many} />
    </div>
  );
}
