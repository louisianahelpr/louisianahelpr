import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { giftGuides as G } from "@/content/giftGuides";
import { guideBySlug } from "@/content/giftGuideCatalog";
import { WISH } from "@/content/giftWishList";
import { saveWishList } from "@/lib/giftWishListApi";
import { useAuthReady } from "@/hooks/useAuthReady";
import { GiftGuideTile } from "./GiftGuideTile";
import { PickThumb } from "./GiftGuideView";
import { GiftOut } from "./GiftOut";
import { GiftWishShare } from "./GiftWishShare";
import { listName, listRefs, pickId, removeFromWishList, setListName, useGiftList } from "./giftList";
import { useWishItems, type WishItem } from "./wishListItems";

/**
 * /gift-guides/my-list (owner 2026-11-18 "My list"; 2026-11-20 "My Wish List": "add something that they can add to
 * their list and send their list to someone"): the list's name (editable, never required), the saved guides as tiles,
 * then every saved gift as a row (photo, name, where it is sold, Shop with our link, Remove) and "Share my list".
 * Empty: one line saying how to fill it. A saved gift the guides no longer carry is left out (never a dead row).
 */

function WishThumb({ item }: { item: WishItem }) {
  const [failed, setFailed] = useState(false);
  if (item.pick) return <PickThumb pick={item.pick} />;
  if (item.image && !failed) {
    return (
      <span className="gg-photo">
        <img className="gg-thumb" loading="lazy" decoding="async" src={item.image} alt="" width={52} height={52} referrerPolicy="no-referrer-when-downgrade" onError={() => setFailed(true)} />
      </span>
    );
  }
  return <span className="gg-thumb gg-letter" aria-hidden="true">{item.store}</span>;
}

/** A small business's own page (not an affiliate link), in a new tab. */
function PlainOut({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  if (!/^https:\/\//.test(href)) return <span className={className}>{children}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className} data-gift-sb-out="">{children}</a>;
}

/** One gift on a wish list: photo, name, where, Shop (our link) and, on the owner's own list, Remove. */
export function WishRow({ item, onRemove }: { item: WishItem; onRemove?: () => void }) {
  const Out = item.out === "plain" ? PlainOut : GiftOut;
  return (
    <li className="gg-wish-row" data-gift-wish-item={item.id}>
      <Out href={item.href} className="gg-item">
        <WishThumb item={item} />
        <span className="gg-nm">
          <span className="gg-nm-name">{item.name}</span>
          {/* UX audit M6: a business shows its town ("Baton Rouge area"), never "On Baton Rouge area". */}
          {item.store && <small className="gg-nm-meta"><span>{item.out === "plain" ? item.store : G.onStore(item.store)}</span></small>}
        </span>
        <span className="sr-only"> ({G.newTab})</span>
      </Out>
      <span className="gg-wish-actions">
        {item.href && <Button asChild variant="outline" size="sm" className="gg-shop-btn">
          <Out href={item.href}>
            <span data-gift-shop="">{item.out === "plain" ? WISH.visit : G.shopAt(item.store)}</span>
            <span aria-hidden="true">&nbsp;›</span>
            <span className="sr-only">: {item.name} ({G.newTab})</span>
          </Out>
        </Button>}
        {onRemove && (
          <Button type="button" variant="ghost" size="sm" className="gg-wish-remove" onClick={onRemove} aria-label={WISH.removeLabel(item.name)} data-gift-wish-remove={item.id}>
            {WISH.remove}
          </Button>
        )}
      </span>
    </li>
  );
}

export function GiftGuideMyList() {
  const list = useGiftList();
  const { user } = useAuthReady();
  // Every saved gift, an old save (no guide) included: it is looked up in the loaded guides.
  const refs = list.picks.map((p) => ({ g: p.guide ?? "", i: pickId(p) }));
  const { items, loading, missing, missingIds } = useWishItems(refs);
  const guides = list.guides.map((s) => guideBySlug(s)).filter((g) => g !== undefined);
  const empty = guides.length === 0 && list.picks.length === 0;
  // UX audit M3: after Remove, focus moves to the next row's Remove (or the previous one, or the list's heading) and
  // the removal is read out.
  const [announce, setAnnounce] = useState("");
  const focusAfter = useRef<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (focusAfter.current === null) return;
    const at = focusAfter.current;
    focusAfter.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-gift-wish-remove]") ?? [];
    const next = buttons[Math.min(at, buttons.length - 1)];
    (next ?? document.getElementById("gift-my-list"))?.focus();
  }, [items.length]);
  const remove = (it: WishItem, index: number) => {
    focusAfter.current = index;
    setAnnounce(WISH.removed(it.name));
    removeFromWishList(it.id);
  };
  return (
    <section aria-labelledby="gift-my-list" data-gift-my-list="">
      <Link to="/gift-guides" className="gg-link" data-gift-back="">← {G.allGuidesLabel}</Link>
      {/* UX audit M4: the list's name is the page's big title. */}
      <h2 id="gift-my-list" className="gg-wish-title" tabIndex={-1}>{listName(list)}</h2>
      <p className="sr-only" role="status" aria-live="polite" data-gift-wish-announce="">{announce}</p>
      {/* UX audit L5: no name field on an empty list. */}
      {!empty && (
        <label className="gg-wish-name" data-gift-wish-name="">
          <span className="gg-finder-q">{WISH.nameLabel}</span>
          <Input value={list.name} onChange={(e) => setListName(e.target.value)} placeholder={WISH.namePlaceholder} aria-describedby="gift-wish-name-help" data-gift-wish-name-input="" />
          <small id="gift-wish-name-help" className="gg-price-note">{WISH.nameHelp}</small>
        </label>
      )}
      {empty && (
        <div className="gg-soon" data-gift-my-list-empty="">
          <p>{WISH.empty}</p>
          <Link to="/gift-guides" className="gg-link">{WISH.emptyCta} ›</Link>
        </div>
      )}
      {list.picks.length > 0 && (
        <>
          <GiftWishShare name={listName(list)} refs={listRefs(list)} save={saveWishList} signedIn={!!user} />
          <p className="gg-price-note" data-gift-wish-where="">{user ? WISH.syncedNote : WISH.deviceNote}</p>
          <div className="gg-rowhead"><h3>{WISH.giftsTitle(items.length)}</h3></div>
          {loading && items.length === 0 ? (
            <p className="gg-soon" role="status">{WISH.loading}</p>
          ) : (
            <ol ref={listRef} className="gg-list gg-wish-list" data-gift-list="">
              {items.map((it, i) => <WishRow key={it.id} item={it} onRemove={() => remove(it, i)} />)}
            </ol>
          )}
          {missing > 0 && (
            <p className="gg-wish-missing" data-gift-wish-missing="">
              {WISH.missing(missing)}{" "}
              <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => missingIds.forEach(removeFromWishList)} data-gift-wish-clear-missing="">{WISH.clearMissing}</Button>
            </p>
          )}
        </>
      )}
      {guides.length > 0 && (
        <>
          <div className="gg-rowhead"><h3>{WISH.guidesTitle}</h3></div>
          <ul className="gg-wrap">{guides.map((g) => <GiftGuideTile key={g.slug} g={g} />)}</ul>
        </>
      )}
    </section>
  );
}
