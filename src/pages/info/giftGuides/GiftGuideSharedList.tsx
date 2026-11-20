import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { WISH } from "@/content/giftWishList";
import { getSharedList, type SharedList } from "@/lib/giftWishListApi";
import { WishRow } from "./GiftGuideMyList";
import { useWishItems } from "./wishListItems";

/**
 * /gift-guides/list/<code> (owner 2026-11-20): a wish list someone sent. No sign-in: the list's name and its gifts, each
 * with its photo and a Shop button carrying our own link (so every purchase from a shared list still earns), then a way
 * to make your own. A code with no list says so, never a blank page; a failed read offers a retry.
 */
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
  const { items, loading } = useWishItems(list?.items ?? []);
  return (
    <section aria-labelledby="gift-shared-list" data-gift-shared-list={code}>
      <p className="gg-finder-q">{WISH.sharedLead}</p>
      <div className="gg-rowhead"><h2 id="gift-shared-list">{list?.name || WISH.title}</h2></div>
      {failed ? (
        <div className="gg-soon" role="alert" data-gift-shared-failed="">
          <p>{WISH.sharedFailed}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setTries((n) => n + 1)}>{WISH.retry}</Button>
        </div>
      ) : list === undefined || (loading && items.length === 0 && (list?.items.length ?? 0) > 0) ? (
        <p className="gg-soon" role="status">{WISH.loading}</p>
      ) : list === null ? (
        <p className="gg-soon" data-gift-shared-missing="">{WISH.sharedMissing}</p>
      ) : items.length === 0 ? (
        <p className="gg-soon" data-gift-shared-empty="">{WISH.sharedEmpty}</p>
      ) : (
        <>
          <p className="gg-price-note">{WISH.sharedIntro}</p>
          <ol className="gg-list gg-wish-list" data-gift-list="">{items.map((it) => <WishRow key={it.id} item={it} />)}</ol>
        </>
      )}
      <Link to="/gift-guides" className="gg-link gg-wish-own" data-gift-shared-own="">{WISH.sharedCta} ›</Link>
    </section>
  );
}
