import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Dialog, DialogAcknowledgeAction, DialogContent, DialogFooter, DialogHero } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { storeOf } from "@/content/giftGuideCatalog";
import { WISH } from "@/content/giftWishList";
import { dollars, parseDollars, type GiftPlan, type PlanPerson } from "@/content/giftGuideFun1120";
import { useAuthReady } from "@/hooks/useAuthReady";
import { shareGiftLists } from "@/lib/giftWishListApi";
import { planActions, useAccountSync, usePlan } from "./fun/plannerStore";
import { PickThumb } from "./GiftGuideView";
import { GiftWishShare } from "./GiftWishShare";
import { AmazonCartForList } from "./AmazonCartButton";
import { AnyStoreAdd } from "./AnyStoreAdd";
import { useOurLinkSync } from "./wishLinkSync";
import { MY_LIST_SLUG, isSaved, itemId, togglePick, useGiftList } from "./giftList";
import { heartTapped } from "./GiftGuideHints";
import { allTotals, closeSaveFor, listTotal, onPersonList, privateIdeas, shareListOf, togglePersonItem, useSaveForHost, useSaveForRequest, type SaveItem } from "./saveForPeople";

/**
 * Save for someone + My lists (owner 2026-11-21: "save items per person, like add a list or something, and it shows the
 * total amount they have added, and they can add/remove stuff as they are browsing the guides"; "they should also be
 * able to share all lists"). Mounted once on a guide page (GiftGuides.tsx):
 *   - the picker a card's heart opens (saveForPeople.requestSaveFor): "Me" (My Wish List, as before) and each person
 *     in the gift planner with their running total; a tap adds the gift to that list or takes it off; "Add a person"
 *     (a name, an optional budget) adds someone and saves the gift for them;
 *   - the "My lists" pill (fixed: bottom centre on a phone, bottom right on a desktop, clear of the guide tool row) with the total across the lists, opening a
 *     panel of each list (gifts, total, budget, remove), Share for a list, "Share all my lists" and "Open planner".
 * The lists are the gift planner's people (plannerStore.ts), so the planner shows the same gifts. Signed in, the
 * planner's account copy is loaded first and nothing is written before it is (as the swipe page). The shared Dialog is
 * a bottom sheet on a phone and a card on a desktop. Guard: src/test/savePerPerson1121.test.tsx.
 */
const money = (n: number) => (n > 0 ? dollars(n) : null);
const summary = (gifts: number, amount: number) => WISH.listCount(gifts, money(amount));

function PersonRow({ p, item, ready }: { p: PlanPerson; item: SaveItem; ready: boolean }) {
  const plan = usePlan();
  const [full, setFull] = useState(false);
  const on = onPersonList(p, item.href);
  const t = listTotal(p);
  return (
    <li>
      <Button type="button" variant="ghost" size="inline" className="gg-savefor-row justify-start whitespace-normal text-left font-normal tracking-normal" aria-pressed={on} disabled={!ready} data-savefor-person={p.id}
        aria-label={on ? WISH.saveForUnpick(p.name, item.name) : WISH.saveForPick(p.name, item.name)}
        onClick={() => setFull(togglePersonItem(plan, p.id, item) === "full")}>
        <span className="gg-savefor-nm"><b>{p.name}</b><small data-savefor-total={p.id}>{summary(t.gifts, t.amount)}</small></span>
        <span className="gg-savefor-check" aria-hidden="true">{on ? "✓" : "+"}</span>
      </Button>
      {full && <p className="gg-price-note" role="alert">{WISH.saveForFull}</p>}
    </li>
  );
}

function AddPerson({ item, ready }: { item: SaveItem; ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !ready) return;
    const b = budget.trim() ? parseDollars(budget) : undefined;
    if (budget.trim() && b === undefined) return setErr("Type an amount like 25 or 25.50.");
    const id = planActions.addPerson(name.trim());
    if (!id) return;
    if (b !== undefined) planActions.setBudget(id, b);
    planActions.addIdea(id, { name: item.name, href: item.href, ...(item.guide ? { guide: item.guide } : {}), ...(item.image ? { image: item.image } : {}), ...(item.price !== undefined ? { price: item.price } : {}) });
    setName("");
    setBudget("");
    setErr(null);
    setOpen(false);
  };
  if (!open) {
    return <Button type="button" variant="outline" size="sm" className="gg-savefor-addbtn" disabled={!ready} onClick={() => setOpen(true)} data-savefor-add="">+ {WISH.saveForAdd}</Button>;
  }
  return (
    <form className="gg-savefor-form" onSubmit={submit} data-savefor-form="">
      <Input aria-label={WISH.saveForName} placeholder={WISH.saveForName} value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} data-savefor-name="" />
      <Input aria-label={WISH.saveForBudget} placeholder={WISH.saveForBudget} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} data-savefor-budget="" />
      <Button type="submit" className="btn-grad-primary" data-savefor-add-submit="">{WISH.saveForAddButton}</Button>
      {err && <p className="gg-price-note" role="alert">{err}</p>}
    </form>
  );
}

function Picker({ item, ready }: { item: SaveItem | null; ready: boolean }) {
  const plan = usePlan();
  const list = useGiftList();
  const onMine = item ? isSaved(list, itemId(item.href)) : false;
  return (
    <Dialog open={item !== null} onOpenChange={(o) => { if (!o) closeSaveFor(); }}>
      <DialogContent data-savefor-picker="">
        <DialogHero title={WISH.saveForTitle} />
        {item && (
          <div className="gg gg-savefor">
            <p className="gg-savefor-gift" data-savefor-gift="">{item.name}</p>
            {!ready && <p className="gg-price-note" role="status">{WISH.saveForLoading}</p>}
            <ul className="gg-savefor-list">
              <li>
                <Button type="button" variant="ghost" size="inline" className="gg-savefor-row justify-start whitespace-normal text-left font-normal tracking-normal" aria-pressed={onMine} data-savefor-me=""
                  aria-label={onMine ? WISH.removeLabel(item.name) : WISH.saveLabel(item.name)}
                  onClick={() => heartTapped(togglePick({ href: item.href, name: item.name, ...(item.guide ? { guide: item.guide } : {}) }))}>
                  <span className="gg-savefor-nm"><b>{WISH.saveForMe}</b><small>{WISH.saveForMeSub(list.picks.length)}</small></span>
                  <span className="gg-savefor-check" aria-hidden="true">{onMine ? "✓" : "+"}</span>
                </Button>
              </li>
              {plan.people.map((p) => <PersonRow key={p.id} p={p} item={item} ready={ready} />)}
            </ul>
            <AddPerson item={item} ready={ready} />
          </div>
        )}
        <DialogFooter>
          <DialogAcknowledgeAction data-savefor-done="">{WISH.saveForDone}</DialogAcknowledgeAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One person's list in the My lists panel: its gifts, total, budget, remove buttons and Share. */
function PanelList({ p, ready }: { p: PlanPerson; ready: boolean }) {
  const t = listTotal(p);
  const share = shareListOf(p);
  return (
    <section className="gg-mylists-person" aria-label={p.name} data-mylists-person={p.id}>
      <div className="gg-mylists-head">
        <b>{p.name}</b>
        <span data-mylists-total={p.id}>{summary(t.gifts, t.amount)}</span>
      </div>
      {p.budget !== undefined && (
        <p className="gg-mylists-budget" data-mylists-budget={p.id}>
          {t.amount > p.budget ? WISH.listOver(dollars(Math.round((t.amount - p.budget) * 100) / 100)) : WISH.listBudget(dollars(t.amount), dollars(p.budget))}
        </p>
      )}
      {p.ideas.length === 0 ? <p className="gg-price-note">{WISH.listEmpty}</p> : (
        <ul className="gg-mylists-items">
          {p.ideas.map((i) => (
            <li key={i.id} data-mylists-item={i.id}>
              {i.image ? <PickThumb pick={{ name: i.name, href: i.href ?? "", store: i.href ? storeOf(i.href) : "", image: i.image }} size={40} /> : <span className="gg-mylists-noimg" aria-hidden="true" />}
              <span className="gg-mylists-name">{i.name}</span>
              {i.price !== undefined && <span className="gg-mylists-price">{dollars(i.price)}</span>}
              <RoundIconButton className="gg-fun-x" aria-label={WISH.listRemove(i.name, p.name)} disabled={!ready} onClick={() => planActions.removeIdea(p.id, i.id)} data-mylists-remove={i.id}>
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
    </section>
  );
}

/** "Share all my lists" (one link with every person's list), for the panel and the gift planner. */
export function ShareAllLists({ plan }: { plan: GiftPlan }) {
  const lists = plan.people.map(shareListOf).filter((l) => l.items.length > 0);
  const hidden = privateIdeas(plan.people);
  if (lists.length === 0) return null;
  return (
    <div className="gg-mylists-shareall" data-share-all-lists="">
      {lists.length > 1 && (
        <GiftWishShare name={WISH.sharedListsTitle} refs={lists.flatMap((l) => l.items)} label={WISH.shareAllLists} message={WISH.shareListsMessage} hint={false} quiet save={() => shareGiftLists(lists)} />
      )}
      <p className="gg-price-note">{WISH.shareListsNote}{hidden > 0 ? ` ${WISH.sharePrivate(hidden)}` : ""}</p>
    </div>
  );
}

function Panel({ open, onOpenChange, ready }: { open: boolean; onOpenChange: (o: boolean) => void; ready: boolean }) {
  const plan = usePlan();
  const list = useGiftList();
  // Owner 11-21: gifts from any store switch to our link once we made it (asked when the panel opens).
  useOurLinkSync(plan, open && ready);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-mylists-panel="">
        <DialogHero title={WISH.myLists} />
        <div className="gg gg-savefor">
          {plan.people.map((p) => <PanelList key={p.id} p={p} ready={ready} />)}
          <ShareAllLists plan={plan} />
          <p className="gg-mylists-links">
            <Link to={`/gift-guides/${MY_LIST_SLUG}`} className="gg-link" onClick={() => onOpenChange(false)} data-mylists-wish="">{WISH.saveForMe}: {WISH.saveForMeSub(list.picks.length)} ›</Link>
            <Link to="/gift-guides/planner" className="gg-link" onClick={() => onOpenChange(false)} data-mylists-planner="">{WISH.openPlanner} ›</Link>
          </p>
        </div>
        <DialogFooter>
          <DialogAcknowledgeAction>{WISH.saveForDone}</DialogAcknowledgeAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SaveForSomeone() {
  useSaveForHost();
  const { user, isReady } = useAuthReady();
  const sync = useAccountSync(user?.id ?? null, isReady);
  // Never write before the account's planner is merged in (a write first would replace it on upload).
  const ready = isReady && (!user || sync !== "device");
  const item = useSaveForRequest();
  const plan = usePlan();
  const [panel, setPanel] = useState(false);
  const total = allTotals(plan);
  const text = summary(total.gifts, total.amount);
  return (
    <>
      <Picker item={item} ready={ready} />
      <Panel open={panel} onOpenChange={setPanel} ready={ready} />
      {total.gifts > 0 && typeof document !== "undefined" && createPortal(
        <Button type="button" size="sm" className="gg-mylists-pill" aria-haspopup="dialog" aria-label={WISH.myListsOpen(text)} onClick={() => setPanel(true)} data-mylists-pill="">
          <b>{WISH.myLists}</b><span data-mylists-pill-total="">{text}</span>
        </Button>,
        document.body,
      )}
    </>
  );
}

/** Scoped like the guides' CSS; the pill is portaled to <body>, so its rules carry their own tokens. */
export const SAVE_FOR_CSS = `
.gg-savefor{display:flex;flex-direction:column;gap:10px}
.gg-savefor-gift{margin:0;font-size:14px;color:var(--gg-muted);overflow-wrap:anywhere}
.gg-savefor-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:6px}
.gg-savefor-row{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;padding:8px 12px;border:1px solid var(--gg-line);border-radius:14px;background:hsl(var(--card));color:var(--gg-ink);text-align:left;cursor:pointer}
.gg-savefor-row[aria-pressed="true"]{border-color:hsl(var(--bark));box-shadow:inset 0 0 0 1px hsl(var(--bark))}
.gg-savefor-row:disabled{cursor:default;opacity:.6}
.gg-savefor-row:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:2px}
.gg-savefor-nm{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.gg-savefor-nm b{font-size:15px;overflow-wrap:anywhere}
.gg-savefor-nm small{font-size:13px;color:var(--gg-muted)}
.gg-savefor-check{flex:none;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;font-size:18px;font-weight:700;color:hsl(var(--bark))}
.gg-savefor-row[aria-pressed="true"] .gg-savefor-check{background:hsl(var(--bark));color:hsl(var(--parchment))}
.gg-savefor-addbtn{align-self:flex-start}
.gg-savefor-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.gg-savefor-form input{flex:1 1 140px;min-width:0;min-height:44px}
.gg-mylists-person{border:1px solid var(--gg-line);border-radius:14px;padding:12px;background:hsl(var(--card))}
.gg-mylists-head{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.gg-mylists-head b{font-size:16px;overflow-wrap:anywhere}
.gg-mylists-head span{font-size:13px;color:var(--gg-muted);white-space:nowrap}
.gg-mylists-budget{margin:2px 0 0;font-size:12.5px;color:var(--gg-muted)}
.gg-mylists-items{list-style:none;margin:8px 0 0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:4px}
.gg-mylists-items li{display:flex;align-items:center;gap:8px;min-width:0}
.gg-mylists-items .gg-photo,.gg-mylists-items .gg-thumb,.gg-mylists-noimg{width:40px;height:40px;flex:none}
.gg-mylists-name{flex:1;min-width:0;font-size:14px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gg-mylists-price{flex:none;font-size:13px;font-weight:600}
.gg-mylists-links{display:flex;flex-wrap:wrap;gap:16px;margin:4px 0 0}
.gg-mylists-shareall .gg-wish-share{margin:0}
.gg-mylists-pill{position:fixed;z-index:40;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom) + var(--bottom-nav-h, 0px));display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 18px;border:0;border-radius:999px;font:600 14px Montserrat,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:pointer;white-space:nowrap}
.gg-mylists-pill:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:2px}
@media (min-width:1024px){.gg-mylists-pill{left:auto;right:24px;transform:none}}
`;
