import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { giftGuides as G } from "@/content/giftGuides";
import { guideBySlug } from "@/content/giftGuideCatalog";
import { WISH } from "@/content/giftWishList";
import { LISTS } from "@/content/giftListsManage";
import { saveWishList } from "@/lib/giftWishListApi";
import { useAuthReady } from "@/hooks/useAuthReady";
import { GiftGuideTile } from "./GiftGuideTile";
import { PickThumb } from "./GiftGuideView";
import { GiftOut } from "./GiftOut";
import { GiftWishShare } from "./GiftWishShare";
import { DeleteMyList } from "./DeleteMyList";
import { Heart, listName, listRefs, pickId, putBackInWishList, removeFromWishList, setListName, useGiftList, type SavedPick } from "./giftList";
import { useWishItems, type WishItem } from "./wishListItems";
import { retryWishListSync, useSyncProblem } from "./wishListSync";
import { giftNameProblem } from "@/lib/giftNameClean";
import { PickPrice, showsPrice } from "@/components/giftGuides/PickPrice";

/**
 * /gift-guides/my-list (owner 2026-11-18 "My list"; 2026-11-20 "My Wish List": "add something that they can add to
 * their list and send their list to someone"): the list's name (editable, never required), the saved guides as tiles,
 * then every saved gift as a row (photo and name as one link to the store with our link, where it is sold) and "Share my list". Each saved gift
 * wears a filled heart in its top-right corner (owner 11-20, replacing the Remove buttons): a tap takes it off the list,
 * the heart goes to an outline and the row stays for this visit (a second tap saves it again), with "Removed · Undo".
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

/**
 * One gift on a wish list: photo and name as ONE link (owner 11-21: "remove the shop at button, when they click the
 * title of the image it will go there to the link"), where, and, on the owner's own list, the heart (outside the link).
 */
export function WishRow({ item, heart }: { item: WishItem; heart?: { saved: boolean; onToggle: () => void } }) {
  const Out = item.out === "plain" ? PlainOut : GiftOut;
  return (
    <li className={heart ? "gg-wish-row gg-wish-mine" : "gg-wish-row"} data-gift-wish-item={item.id} {...(heart && !heart.saved ? { "data-gift-wish-removed": "" } : {})}>
      <Out href={item.href} className="gg-item">
        <WishThumb item={item} />
        <span className="gg-nm">
          <span className="gg-nm-name">{item.name}</span>
          {/* UX audit M6: a business shows its town ("Baton Rouge area"), never "On Baton Rouge area". */}
          {item.store && <small className="gg-nm-meta"><span>{item.out === "plain" ? item.store : G.onStore(item.store)}</span>{item.pick && showsPrice(item.pick) ? <> · <PickPrice pick={item.pick} /></>
            : item.out === "affiliate" && <> · <span data-gift-wish-no-price="">{LISTS.priceAtStore}</span></>}</small>}
        </span>
        <span className="sr-only"> ({G.newTab})</span>
      </Out>
      {heart && (
        <Heart saved={heart.saved} label={heart.saved ? WISH.removeLabel(item.name) : WISH.saveLabel(item.name)} onToggle={heart.onToggle} className="gg-heart-pick gg-heart-wish"
          data={{ "data-gift-wish-remove": item.id }} />
      )}
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
  // A removal is read out (UX audit M3); the row stays (its heart now an outline), so focus stays on the heart.
  const [announce, setAnnounce] = useState("");
  // Gifts taken off this visit: still shown where they were, outlined, until a tap (or Undo) saves them again.
  const [gone, setGone] = useState<{ item: WishItem; pick: SavedPick; index: number }[]>([]);
  const [toast, setToast] = useState<{ item: WishItem; pick: SavedPick; index: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);
  // The name as typed: kept on the list only while it has no link or phone number (verify audit L), so the list, the
  // account's copy and any share always hold the last good name.
  const [typed, setTyped] = useState<string | null>(null);
  const nameBad = typed !== null && giftNameProblem(typed) !== null;
  const syncProblem = useSyncProblem();
  const onName = (v: string) => {
    setTyped(v);
    if (!giftNameProblem(v)) setListName(v);
  };
  const listRef = useRef<HTMLOListElement>(null);
  const remove = (it: WishItem) => {
    const index = list.picks.findIndex((p) => pickId(p) === it.id);
    const pick = list.picks[index];
    if (!pick) return;
    const g = { item: it, pick, index };
    setGone((xs) => [...xs.filter((x) => x.item.id !== it.id), g]);
    setToast(g);
    setAnnounce(WISH.removed(it.name));
    removeFromWishList(it.id);
  };
  const saveAgain = (g: { item: WishItem; pick: SavedPick; index: number }) => {
    if (!putBackInWishList(g.pick, g.index)) return;
    setGone((xs) => xs.filter((x) => x.item.id !== g.item.id));
    setToast((t) => (t?.item.id === g.item.id ? null : t));
    setAnnounce("");
  };
  // The saved gifts, with this visit's removed ones back in their places (outlined).
  const shown: { item: WishItem; saved: boolean }[] = items.filter((it) => !gone.some((g) => g.item.id === it.id)).map((item) => ({ item, saved: true }));
  for (const g of [...gone].sort((a, b) => a.index - b.index)) shown.splice(Math.min(g.index, shown.length), 0, { item: g.item, saved: false });
  return (
    <section aria-labelledby="gift-my-list" data-gift-my-list="">
      {/* Polish audit 1122 #9: no "← All guides" link here; the head row's back arrow already goes to /gift-guides. */}
      {/* UX audit M4: the list's name is the page's big title. */}
      <h2 id="gift-my-list" className="gg-wish-title" tabIndex={-1}>{listName(list)}</h2>
      <p className="sr-only" role="status" aria-live="polite" data-gift-wish-announce="">{announce}</p>
      {/* UX audit L5: no name field on an empty list. */}
      {!empty && (
        <label className="gg-wish-name" data-gift-wish-name="">
          <span className="gg-finder-q">{WISH.nameLabel}</span>
          <Input value={typed ?? list.name} onChange={(e) => onName(e.target.value)} placeholder={WISH.namePlaceholder} aria-describedby="gift-wish-name-help" aria-invalid={nameBad || undefined} data-gift-wish-name-input="" />
          {/* One help line (one id): the hint, or why the name is not kept. */}
          <small id="gift-wish-name-help" className="gg-price-note" role={nameBad ? "alert" : undefined} {...(nameBad ? { "data-gift-wish-name-problem": "" } : {})}>
            {nameBad ? WISH.nameProblem : WISH.nameHelp}
          </small>
        </label>
      )}
      {empty && (
        <div className="gg-soon" data-gift-my-list-empty="">
          <p>{WISH.empty}</p>
          <Link to="/gift-guides" className="gg-link">{WISH.emptyCta} ›</Link>
        </div>
      )}
      {(list.picks.length > 0 || gone.length > 0) && (
        <>
          <GiftWishShare name={listName(list)} refs={listRefs(list)} save={saveWishList} signedIn={!!user} />
          {user && syncProblem
            ? <p className="gg-price-note" role="alert"><span data-gift-wish-sync-problem="">{syncProblem}</span> <Button type="button" variant="link" size="inline" className="gg-link" onClick={retryWishListSync} data-gift-wish-sync-retry="">{WISH.syncRetry}</Button></p>
            : <p className="gg-price-note" data-gift-wish-where="">{user ? WISH.syncedNote : WISH.deviceNote}</p>}
          {user && <DeleteMyList />}
          <div className="gg-rowhead"><h3>{WISH.giftsTitle(items.length)}</h3></div>
          {loading && items.length === 0 ? (
            <p className="gg-soon" role="status">{WISH.loading}</p>
          ) : (
            <ol ref={listRef} className="gg-list gg-wish-list" data-gift-list="">
              {shown.map(({ item: it, saved }) => {
                const g = gone.find((x) => x.item.id === it.id);
                return <WishRow key={it.id} item={it} heart={{ saved, onToggle: () => (saved ? remove(it) : g && saveAgain(g)) }} />;
              })}
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
      {toast && createPortal(
        <div className="gg-toast" role="status" data-gift-wish-toast="">
          <span className="gg-toast-text">{WISH.removedToast}</span>
          <Button type="button" variant="link" size="inline" className="gg-toast-link gg-toast-undo" onClick={() => saveAgain(toast)} aria-label={WISH.undoLabel(toast.item.name)} data-gift-wish-undo="">{WISH.undo}</Button>
        </div>,
        document.body,
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
