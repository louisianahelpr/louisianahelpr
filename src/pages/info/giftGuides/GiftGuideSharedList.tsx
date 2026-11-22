import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { WISH } from "@/content/giftWishList";
import { getSharedList, type SharedAnyItem, type SharedList, type SharedPersonList } from "@/lib/giftWishListApi";
import { dollars } from "@/content/giftGuideFun1120";
import { showsPrice } from "@/components/giftGuides/PickPrice";
import { WishRow } from "./GiftGuideMyList";
import { DEFAULT_LIST_NAME } from "./giftList";
import { shopName } from "@/lib/wishLinks";
import { useWishItems } from "./wishListItems";

/**
 * /gift-guides/list/<code> (owner 2026-11-20): a wish list someone sent. No sign-in: the list's name as the big title
 * (the sender's own words, under "Someone shared their wish list with you", never under our brand: security review
 * #4, UX audit M4), and its gifts, each with its photo and name as one link carrying our own link (so every purchase from a
 * shared list still earns), then a way to make your own. Gifts the guides no longer carry are counted, never silently
 * dropped (UX audit M7). The tab title is the list's name (UX audit L4). A code with no list says so; a failed read
 * offers a retry.
 */
/**
 * One person's list on a lists share (owner 2026-11-21, "share all lists"): its name, its count and the sum of the
 * prices the guides show today ("3 gifts · about $54"), and its gifts as on any shared list. No budget or Bought mark
 * is ever in a share (gift_wish_lists_share stores names and refs only).
 */
/** A shop's short name from our link ("Etsy"), or none when the link does not read. */
const shopOf = (href: string) => {
  try {
    return shopName(new URL(href));
  } catch {
    // An unreadable link names no shop.
    return "";
  }
};

/**
 * A gift from any store on a shared list (owner 11-21): the sender's words, and a Shop link only once we made our own
 * link for it ("Link coming soon" until then; nothing promised for one we dismissed). The link they pasted is never
 * shown here (gift_wish_list_get never returns it).
 */
function SharedAnyRow({ item }: { item: SharedAnyItem }) {
  if (item.href) return <WishRow item={{ id: item.id, name: item.name, store: shopOf(item.href), href: item.href, out: "affiliate" }} />;
  return (
    <li className="gg-wish-row" data-gift-shared-any={item.id}>
      <span className="gg-item">
        <span className="gg-thumb gg-letter" aria-hidden="true">{item.name.charAt(0).toUpperCase()}</span>
        <span className="gg-nm">
          <span className="gg-nm-name">{item.name}</span>
          {!item.dismissed && <small className="gg-nm-meta" data-gift-shared-any-soon="">{WISH.sharedAnySoon}</small>}
        </span>
      </span>
    </li>
  );
}

export function SharedPerson({ list, index }: { list: SharedPersonList; index: number }) {
  const { items, loading, missing } = useWishItems(list.items);
  const amount = Math.round(items.reduce((t, it) => t + (it.pick && showsPrice(it.pick) ? it.pick.price ?? 0 : 0), 0));
  const id = `gift-shared-person-${index}`;
  return (
    <section aria-labelledby={id} className="gg-shared-person" data-gift-shared-person={list.name}>
      <h3 id={id} className="gg-shared-person-name">{list.name}</h3>
      {!loading && <p className="gg-price-note" data-gift-shared-person-total="">{WISH.sharedListTotal(items.length + (list.any ?? []).length, amount > 0 ? dollars(amount) : null)}</p>}
      {loading && items.length === 0 && (list.any ?? []).length === 0 ? <p className="gg-soon" role="status">{WISH.loading}</p> : (
        <ol className="gg-list gg-wish-list" data-gift-list="">
          {items.map((row) => <WishRow key={row.id} item={row} />)}
          {(list.any ?? []).map((row) => <SharedAnyRow key={row.id} item={row} />)}
        </ol>
      )}
      {missing > 0 && <p className="gg-wish-missing" data-gift-wish-missing="">{WISH.missing(missing)}</p>}
    </section>
  );
}

export function GiftGuideSharedList({ code, read = getSharedList }: { code: string; read?: (code: string) => Promise<SharedList | null> }) {
  const [list, setList] = useState<SharedList | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    setList(undefined);
    read(code).then(
      (l) => live && setList(l),
      (e: unknown) => {
        // Not silent: the page says it could not load and offers a retry.
        console.warn("gift wish list: shared list read failed", e);
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [code, read, tries]);
  // Holiday audit C9: the sender's own name for the list, or (unnamed, or our default "My Wish List", which reads as
  // the recipient's own list) "A wish list for you"; a code with no list says "List not found".
  const named = list?.name?.trim() && list.name.trim() !== DEFAULT_LIST_NAME ? list.name.trim() : null;
  const many = list?.lists && list.lists.length > 0 ? list.lists : null;
  const title = list === null ? WISH.sharedMissingTitle : many ? WISH.sharedListsTitle : named ?? WISH.sharedUnnamed;
  useEffect(() => {
    if (list === undefined) return;
    document.title = `${many ? WISH.sharedListsTitle : named ?? WISH.sharedLead} — Louisiana Helpr`;
  }, [list, named, many]);
  const { items, loading, missing } = useWishItems(list?.items ?? []);
  return (
    <section aria-labelledby="gift-shared-list" data-gift-shared-list={code}>
      <p className="gg-wish-lead" data-gift-shared-lead="">{many ? WISH.sharedListsLead : WISH.sharedLead}</p>
      <h2 id="gift-shared-list" className="gg-wish-title" data-gift-shared-title="">{title}</h2>
      {failed ? (
        <div className="gg-soon" role="alert" data-gift-shared-failed="">
          <p>{WISH.sharedFailed}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setTries((n) => n + 1)}>{WISH.retry}</Button>
        </div>
      ) : list === undefined || (loading && items.length === 0 && (list?.items.length ?? 0) > 0) ? (
        <p className="gg-soon" role="status">{WISH.loading}</p>
      ) : many ? (
        <>
          <p className="gg-price-note">{WISH.sharedIntro}</p>
          {many.map((l, k) => <SharedPerson key={`${k} ${l.name}`} list={l} index={k} />)}
        </>
      ) : list === null ? (
        <p className="gg-soon" data-gift-shared-missing="">{WISH.sharedMissing}</p>
      ) : items.length === 0 ? (
        <>
          <p className="gg-soon" data-gift-shared-empty="">{WISH.sharedEmpty}</p>
          {missing > 0 && <p className="gg-wish-missing" data-gift-wish-missing="">{WISH.missing(missing)}</p>}
        </>
      ) : (
        <>
          <p className="gg-price-note">{WISH.sharedIntro}</p>
          <ol className="gg-list gg-wish-list" data-gift-list="">{items.map((it) => <WishRow key={it.id} item={it} />)}</ol>
          {missing > 0 && <p className="gg-wish-missing" data-gift-wish-missing="">{WISH.missing(missing)}</p>}
        </>
      )}
      {/* Owner 11-21: the affiliate disclosure, on every list someone shared. */}
      {list && <p className="gg-price-note" data-gift-shared-supports="">{WISH.sharedSupports}</p>}
      <Link to="/gift-guides" className="gg-link gg-wish-own" data-gift-shared-own="">{WISH.sharedCta} ›</Link>
    </section>
  );
}
