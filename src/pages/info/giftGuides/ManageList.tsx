import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowUpRight, Gift, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { guidePicksVersion, loadGuidePicks, storeOf, subscribeGuidePicks } from "@/content/giftGuideCatalog";
import { OWNER_LIST_GUIDES } from "@/content/giftGuidePeople.mjs";
import { livePicks } from "./fun/GuidePicksPicker";
import { WISH } from "@/content/giftWishList";
import { dollars, parseDollars, type PlanPerson } from "@/content/giftGuideFun1120";
import { shareGiftLists } from "@/lib/giftWishListApi";
import { successToast } from "@/lib/toast";
import { planActions } from "./fun/plannerStore";
import { PickThumb } from "./GiftGuideView";
import { PickPrice, showsPrice } from "@/components/giftGuides/PickPrice";
import { GiftWishShare } from "./GiftWishShare";
import { AmazonCartForList } from "./AmazonCartButton";
import { AnyStoreAdd } from "./AnyStoreAdd";
import { MY_LIST_SLUG, emptyWishList, pickId, putBackInWishList, removeFromWishList, useGiftList } from "./giftList";
import { budgetStatus, listTotal, shareListOf } from "./saveForPeople";

/**
 * Managing a list in the guides' My lists sheet (owner 2026-11-21: "How do they edit or remove items in the list or
 * delete the list? I entered the budget as 100 but it doesn't say how much I have left to spend or how much I'm over").
 *   - ListLine: "5 gifts · $163.25 · $63.25 over" (the over part in the app's warning ink) or "... · $36.75 left";
 *     no budget: the count and total only; "+ 1 with no price" and "· $12 bought" when they apply (holiday audit 1121
 *     #5, #8). Worked out in whole cents (budgetStatus).
 *   - PersonList: a person's list: the line, Edit (name and budget), every gift (photo, name, price) with Remove and a
 *     "Removed · Undo" toast, add from any store, Amazon cart, Share, and Delete list (the shared confirm dialog).
 *   - MyWishList: "Me": its gifts with Remove and Undo, Open My Wish List (rename and share there) and Clear list
 *     (confirmed; the list stays, empty).
 * Guard: src/test/saveForManage1121.test.tsx.
 */
/**
 * A list gift's picture (coordinator 11-21: a saved guide pick shows the pick's photo, as on its card): its own saved
 * photo; else the guide pick with the same link (picks saved before photos were kept); else, for a typed idea or a
 * link from another store, a small gift icon in the same 40px tile, never an empty gap.
 */
/** The guide pick with this link (loads the owner's guides' picks once), or undefined. */
function useCatalogPick(href: string | undefined) {
  const version = useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  useEffect(() => {
    Promise.all(OWNER_LIST_GUIDES.map((s) => loadGuidePicks(s))).catch((e: unknown) => {
      // The photo and price are a help: without the guides the tile shows the gift icon.
      console.warn("gift list: guide picks failed to load", e);
    });
  }, []);
  return useMemo(() => (href && version >= 0 ? livePicks().find((p) => p.href === href) : undefined), [href, version]);
}

function ItemThumb({ name, href, image }: { name: string; href?: string; image?: string }) {
  const pick = useCatalogPick(image ? undefined : href);
  if (image) return <PickThumb pick={{ name, href: href ?? "", store: href ? storeOf(href) : "", image }} size={40} />;
  if (pick) return <PickThumb pick={pick} size={40} />;
  return <span className="gg-mylists-noimg gg-mylists-gift" aria-hidden="true" data-list-gift-icon=""><Gift /></span>;
}

/** A My Wish List gift's price, as its guide card shows it (the wish list keeps only names and links). */
function MePrice({ href }: { href: string }) {
  const pick = useCatalogPick(href);
  return pick && showsPrice(pick) ? <span className="gg-mylists-price"><PickPrice pick={pick} /></span> : null;
}

export function ListLine({ p }: { p: PlanPerson }) {
  const t = listTotal(p);
  const s = budgetStatus(p);
  return (
    <span className="gg-list-line" data-list-line={p.id}>
      {WISH.listCount(t.gifts, t.amount > 0 ? dollars(t.amount) : null, t.unpriced)}
      {s.kind === "over" && <> · <span className="gg-list-over" data-list-over="">{WISH.listOverYour(dollars(s.amount))}</span></>}
      {s.kind === "left" && <> · <span className="gg-list-left" data-list-left="">{WISH.listLeft(dollars(s.amount))}</span></>}
      {t.bought > 0 && <> · <span data-list-bought="">{WISH.listBought(dollars(t.bought))}</span></>}
    </span>
  );
}

function EditPerson({ p, onDone }: { p: PlanPerson; onDone: () => void }) {
  const [name, setName] = useState(p.name);
  const [budget, setBudget] = useState(p.budget !== undefined ? String(p.budget) : "");
  const [err, setErr] = useState<string | null>(null);
  const save = (e: FormEvent) => {
    e.preventDefault();
    const b = budget.trim() ? parseDollars(budget) : undefined;
    if (budget.trim() && b === undefined) return setErr(WISH.editBadBudget);
    if (name.trim()) planActions.renamePerson(p.id, name.trim());
    planActions.setBudget(p.id, b);
    onDone();
  };
  return (
    <form className="gg-savefor-form" onSubmit={save} data-list-edit={p.id}>
      <Input aria-label={WISH.editName} placeholder={WISH.editName} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-list-edit-name="" />
      <Input aria-label={WISH.editBudget} placeholder={WISH.editBudget} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} data-list-edit-budget="" />
      <Button type="submit" size="sm" className="btn-grad-primary" data-list-edit-save="">{WISH.editSave}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>{WISH.editCancel}</Button>
      {err && <p className="gg-price-note" role="alert">{err}</p>}
    </form>
  );
}

/**
 * The small icon row inside each box of the Save for someone sheet (owner 11-21: "Remove view list. Add an open icon in
 * the box for them to open it, same for edit and delete"): Open (that list's sheet), Edit (name and budget, here) and
 * Delete (asked first in the shared dialog); for "Me" (`p` undefined): Open and Clear. 44px each, apart from the box's
 * save/remove tap. `onOpen`: opens the list's sheet.
 */
export function ListTools({ p, ready, onOpen }: { p?: PlanPerson; ready: boolean; onOpen: () => void }) {
  const list = useGiftList();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const name = p ? p.name : WISH.myWishListName;
  return (
    <>
      <div className="gg-savefor-tools" data-savefor-tools={p ? p.id : "me"}>
        <RoundIconButton className="gg-savefor-tool" aria-label={WISH.openListOf(name)} onClick={onOpen} data-savefor-open={p ? p.id : "me"}><ArrowUpRight aria-hidden="true" /></RoundIconButton>
        {p && <RoundIconButton className="gg-savefor-tool" aria-label={WISH.editListOf(p.name)} aria-expanded={editing} disabled={!ready} onClick={() => setEditing((v) => !v)} data-savefor-edit={p.id}><Pencil aria-hidden="true" /></RoundIconButton>}
        {(p || list.picks.length > 0) && (
          <RoundIconButton className="gg-savefor-tool" aria-label={p ? WISH.deleteListOf(p.name) : WISH.clearList} disabled={!ready} onClick={() => setConfirming(true)} data-savefor-delete={p ? p.id : "me"}><Trash2 aria-hidden="true" /></RoundIconButton>
        )}
      </div>
      {p && editing && <EditPerson p={p} onDone={() => setEditing(false)} />}
      <BrandConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={p ? WISH.deleteListTitle(p.name) : WISH.clearListTitle}
        description={p ? WISH.deleteListBody(p.name, p.ideas.length) : WISH.clearListBody(list.picks.length)}
        primaryLabel={p ? WISH.deleteList : WISH.clearList}
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => { if (p) planActions.removePerson(p.id); else emptyWishList(); setConfirming(false); }}
        secondaryLabel={WISH.keepList}
      />
    </>
  );
}

/** One person's list, with everything to manage it. `ready`: false while the account's planner is still loading. */
export function PersonList({ p, ready }: { p: PlanPerson; ready: boolean }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const share = shareListOf(p);
  const remove = (index: number) => {
    const idea = p.ideas[index];
    planActions.removeIdea(p.id, idea.id);
    successToast(WISH.removedGift(idea.name), { action: { label: WISH.undo, onClick: () => planActions.restoreIdea(p.id, idea, index) } });
  };
  return (
    <section className="gg-mylists-person" aria-label={WISH.listOf(p.name)} data-mylists-person={p.id}>
      <div className="gg-mylists-head">
        <b>{p.name}</b>
        <span className="gg-mylists-actions">
          <Button type="button" variant="link" size="inline" className="gg-link" aria-label={WISH.editListOf(p.name)} aria-expanded={editing} disabled={!ready} onClick={() => setEditing((v) => !v)} data-list-edit-open={p.id}>{WISH.editList}</Button>
        </span>
      </div>
      <p className="gg-mylists-budget" data-mylists-total={p.id}><ListLine p={p} /></p>
      {editing && <EditPerson p={p} onDone={() => setEditing(false)} />}
      {p.ideas.length === 0 ? <p className="gg-price-note">{WISH.listEmpty}</p> : (
        <ul className="gg-mylists-items">
          {p.ideas.map((i, k) => (
            <li key={i.id} data-mylists-item={i.id}>
              <ItemThumb name={i.name} href={i.href} image={i.image} />
              <span className="gg-mylists-name">{i.name}</span>
              {i.price !== undefined ? <span className="gg-mylists-price">{dollars(i.price)}</span>
                : i.href && <span className="gg-mylists-price gg-mylists-noprice" data-list-no-price={i.id}>{WISH.priceAtStore}</span>}
              <RoundIconButton className="gg-fun-x" aria-label={WISH.listRemove(i.name, p.name)} disabled={!ready} onClick={() => remove(k)} data-mylists-remove={i.id}>
                <span aria-hidden="true">×</span>
              </RoundIconButton>
            </li>
          ))}
        </ul>
      )}
      <AnyStoreAdd person={p} disabled={!ready} />
      <AmazonCartForList person={p} />
      {share.items.length > 0 && (
        <GiftWishShare name={p.name} refs={share.items} label={WISH.shareThisList} message={WISH.shareListsMessage} hint={false} quiet save={() => shareGiftLists([share])} />
      )}
      <Button type="button" variant="link" size="inline" className="gg-link gg-list-delete" disabled={!ready} onClick={() => setConfirming(true)} data-list-delete={p.id}>{WISH.deleteList}</Button>
      <BrandConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={WISH.deleteListTitle(p.name)}
        description={WISH.deleteListBody(p.name, p.ideas.length)}
        primaryLabel={WISH.deleteList}
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => { planActions.removePerson(p.id); setConfirming(false); }}
        secondaryLabel={WISH.keepList}
      />
    </section>
  );
}

/** "Me": My Wish List's gifts with Remove and Undo, a way to the full list (rename, share) and Clear list. */
export function MyWishList({ onLeave }: { onLeave: () => void }) {
  const list = useGiftList();
  const [confirming, setConfirming] = useState(false);
  const remove = (index: number) => {
    const pick = list.picks[index];
    removeFromWishList(pickId(pick));
    successToast(WISH.removedGift(pick.name), { action: { label: WISH.undo, onClick: () => { putBackInWishList(pick, index); } } });
  };
  return (
    <section className="gg-mylists-person" aria-label={WISH.saveForMe} data-mylists-me="">
      <div className="gg-mylists-head"><b>{WISH.saveForMe}</b></div>
      <p className="gg-mylists-budget">{WISH.saveForMeSub(list.picks.length)}</p>
      {list.picks.length === 0 ? <p className="gg-price-note">{WISH.listEmpty}</p> : (
        <ul className="gg-mylists-items">
          {list.picks.map((s, k) => (
            <li key={pickId(s)} data-mylists-me-item={pickId(s)}>
              <ItemThumb name={s.name} href={s.href} />
              <span className="gg-mylists-name">{s.name}</span>
              <MePrice href={s.href} />
              <RoundIconButton className="gg-fun-x" aria-label={WISH.removeLabel(s.name)} onClick={() => remove(k)} data-mylists-me-remove={pickId(s)}>
                <span aria-hidden="true">×</span>
              </RoundIconButton>
            </li>
          ))}
        </ul>
      )}
      <p className="gg-mylists-links">
        <Link to={`/gift-guides/${MY_LIST_SLUG}`} className="gg-link" onClick={onLeave} data-mylists-wish="">{WISH.openWishList} ›</Link>
        {list.picks.length > 0 && (
          <Button type="button" variant="link" size="inline" className="gg-link gg-list-delete" onClick={() => setConfirming(true)} data-list-clear="">{WISH.clearList}</Button>
        )}
      </p>
      <BrandConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={WISH.clearListTitle}
        description={WISH.clearListBody(list.picks.length)}
        primaryLabel={WISH.clearList}
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => { emptyWishList(); setConfirming(false); }}
        secondaryLabel={WISH.keepList}
      />
    </section>
  );
}
