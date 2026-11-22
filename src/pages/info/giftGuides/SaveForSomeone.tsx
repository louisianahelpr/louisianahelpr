import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Dialog, DialogAcknowledgeAction, DialogContent, DialogFooter, DialogHero } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WISH } from "@/content/giftWishList";
import { dollars, parseDollars, type GiftPlan, type PlanPerson } from "@/content/giftGuideFun1120";
import { useAuthReady } from "@/hooks/useAuthReady";
import { shareGiftLists } from "@/lib/giftWishListApi";
import { planActions, useAccountSync, usePlan } from "./fun/plannerStore";
import { GiftWishShare } from "./GiftWishShare";
import { useOurLinkSync } from "./wishLinkSync";
import { isSaved, itemId, togglePick, useGiftList } from "./giftList";
import { ListLine, ListTools, MyWishList, PersonList } from "./ManageList";
import { successToast } from "@/lib/toast";
import { heartTapped } from "./GiftGuideHints";
import { allTotals, closeMyLists, closeSaveFor, onPersonList, openMyLists, privateIdeas, shareListOf, togglePersonItem, useMyListsTarget, useSaveForHost, useSaveForRequest, type SaveItem } from "./saveForPeople";

/**
 * Save for someone + My lists (owner 2026-11-21: "save items per person, like add a list or something, and it shows the
 * total amount they have added, and they can add/remove stuff as they are browsing the guides"; "they should also be
 * able to share all lists"). Mounted once on a guide page (GiftGuides.tsx):
 *   - the picker a card's heart opens (saveForPeople.requestSaveFor): "Me" (My Wish List, as before) and each person
 *     in the gift planner with their running total; a tap adds the gift to that list or takes it off; "Add a person"
 *     (a name, an optional budget) adds someone and saves the gift for them;
 *   - the "My lists" pill (fixed: bottom centre on a phone, bottom right on a desktop, clear of the guide tool row) with the total across the lists, opening a
 *     panel of each list (gifts, total, budget, remove), Share for a list, "Share all my lists" and "Open planner".
 *   - managing a list (owner 2026-11-21, "How do they edit or remove items in the list or delete the list?"): each
 *     picker row shows its total against the budget ("$36.75 left of $100" / "$63.25 over your $100"), says when the
 *     gift is on it (tap again to take it off) and has "View list"; Done says "Saved for <name> · View list"; the
 *     guides' heart opens My lists too. A list's sheet (ManageList.tsx): Remove + Undo, Edit name and budget, Share,
 *     Delete list (confirmed); "Me": Remove + Undo and Clear list. Guard: src/test/saveForManage1121.test.tsx.
 * The lists are the gift planner's people (plannerStore.ts), so the planner shows the same gifts. Signed in, the
 * planner's account copy is loaded first and nothing is written before it is (as the swipe page). The shared Dialog is
 * a bottom sheet on a phone and a card on a desktop. Guard: src/test/savePerPerson1121.test.tsx.
 */
const money = (n: number) => (n > 0 ? dollars(n) : null);
const summary = (gifts: number, amount: number, unpriced: number) => WISH.listCount(gifts, money(amount), unpriced);

// Owner 11-21 ("How do they edit or remove items ... I entered the budget as 100 but it doesn't say how much I have
// left"): each row shows the list's total against its budget, says when this gift is on it (tap again to take it off),
// and (owner 11-21, "Add an open icon in the box ... same for edit and delete") its own Open, Edit and Delete icons
// in the same box. `onAdded`: told when the tap put the gift on a list.
function PersonRow({ p, item, ready, onAdded }: { p: PlanPerson; item: SaveItem; ready: boolean; onAdded: (id: string, name: string) => void }) {
  const plan = usePlan();
  const [full, setFull] = useState(false);
  const on = onPersonList(p, item.href);
  const tap = () => {
    const r = togglePersonItem(plan, p.id, item);
    setFull(r === "full");
    if (r === "added") onAdded(p.id, p.name);
  };
  return (
    <li>
      <div className="gg-savefor-box" data-on={on ? "" : undefined}>
        <Button type="button" variant="ghost" size="inline" className="gg-savefor-row justify-start whitespace-normal text-left font-normal tracking-normal" aria-pressed={on} disabled={!ready} data-savefor-person={p.id}
          aria-label={on ? WISH.saveForUnpick(p.name, item.name) : WISH.saveForPick(p.name, item.name)} onClick={tap}>
          <span className="gg-savefor-nm">
            <b>{p.name}</b>
            <small data-savefor-total={p.id}><ListLine p={p} /></small>
            {on && <small className="gg-savefor-on" data-savefor-on={p.id}>{WISH.onListHint}</small>}
          </span>
          <span className="gg-savefor-check" aria-hidden="true">{on ? "✓" : "+"}</span>
        </Button>
        <ListTools p={p} ready={ready} onOpen={() => { closeSaveFor(); openMyLists(p.id); }} />
      </div>
      {full && <p className="gg-price-note" role="alert">{WISH.saveForFull}</p>}
    </li>
  );
}

function AddPerson({ item, ready, onAdded }: { item: SaveItem; ready: boolean; onAdded: (id: string, name: string) => void }) {
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
    onAdded(id, name.trim());
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
  // Owner 11-21: after Done, "Saved for Zander · View list" (the lists this gift went on while the sheet was open).
  const saved = useRef(new Map<string, string>());
  useEffect(() => {
    saved.current = new Map();
  }, [item?.href]);
  const added = (id: string, name: string) => saved.current.set(id, name);
  const close = () => {
    const s = [...saved.current];
    if (s.length > 0) {
      successToast(WISH.savedFor(s.map(([, n]) => n).join(", ")), { action: { label: WISH.viewList, onClick: () => { openMyLists(s.length === 1 ? s[0][0] : null); } } });
    }
    closeSaveFor();
  };
  const tapMine = (gift: SaveItem) => {
    const r = togglePick({ href: gift.href, name: gift.name, ...(gift.guide ? { guide: gift.guide } : {}) });
    heartTapped(r, true);
    if (r === "added") added("me", WISH.myWishListName);
  };
  return (
    <Dialog open={item !== null} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent data-savefor-picker="">
        <DialogHero title={WISH.saveForTitle} />
        {item && (
          <div className="gg gg-savefor">
            <p className="gg-savefor-gift" data-savefor-gift="">{item.name}</p>
            {!ready && <p className="gg-price-note" role="status">{WISH.saveForLoading}</p>}
            <ul className="gg-savefor-list">
              <li>
                <div className="gg-savefor-box" data-on={onMine ? "" : undefined}>
                  <Button type="button" variant="ghost" size="inline" className="gg-savefor-row justify-start whitespace-normal text-left font-normal tracking-normal" aria-pressed={onMine} data-savefor-me=""
                    aria-label={onMine ? WISH.removeLabel(item.name) : WISH.saveLabel(item.name)} onClick={() => tapMine(item)}>
                    <span className="gg-savefor-nm">
                      <b>{WISH.saveForMe}</b><small>{WISH.saveForMeSub(list.picks.length)}</small>
                      {onMine && <small className="gg-savefor-on">{WISH.onListHint}</small>}
                    </span>
                    <span className="gg-savefor-check" aria-hidden="true">{onMine ? "✓" : "+"}</span>
                  </Button>
                  <ListTools ready={ready} onOpen={() => { closeSaveFor(); openMyLists("me"); }} />
                </div>
              </li>
              {plan.people.map((p) => <PersonRow key={p.id} p={p} item={item} ready={ready} onAdded={added} />)}
            </ul>
            <AddPerson item={item} ready={ready} onAdded={added} />
          </div>
        )}
        <DialogFooter>
          <DialogAcknowledgeAction data-savefor-done="">{WISH.saveForDone}</DialogAcknowledgeAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

// Owner 11-21: My lists, every list (the pill, the guides' heart) or one ("View list", the "Saved for" toast), each with
// everything to manage it (ManageList.tsx). A person deleted while their own sheet is open shows every list instead.
function Panel({ only, ready }: { only: string | null | undefined; ready: boolean }) {
  const plan = usePlan();
  const open = only !== undefined;
  // Owner 11-21: gifts from any store switch to our link once we made it (asked when the panel opens).
  useOurLinkSync(plan, open && ready);
  const one = only && only !== "me" ? plan.people.find((p) => p.id === only) : undefined;
  const all = !only || (only !== "me" && !one);
  const leave = () => closeMyLists();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeMyLists(); }}>
      <DialogContent data-mylists-panel={all ? "" : only}>
        <DialogHero title={one ? WISH.listOf(one.name) : only === "me" ? WISH.myWishListName : WISH.myLists} />
        <div className="gg gg-savefor">
          {(all || only === "me") && <MyWishList onLeave={leave} />}
          {(all ? plan.people : one ? [one] : []).map((p) => <PersonList key={p.id} p={p} ready={ready} />)}
          {all && <ShareAllLists plan={plan} />}
          <p className="gg-mylists-links">
            {!all && <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => openMyLists(null)} data-mylists-all="">{WISH.myLists} ›</Button>}
            <Link to="/gift-guides/planner" className="gg-link" onClick={leave} data-mylists-planner="">{WISH.openPlanner} ›</Link>
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
  const target = useMyListsTarget();
  const total = allTotals(plan);
  const text = summary(total.gifts, total.amount, total.unpriced);
  return (
    <>
      <Picker item={item} ready={ready} />
      <Panel only={target ? target.only : undefined} ready={ready} />
      {total.gifts > 0 && typeof document !== "undefined" && createPortal(
        <Button type="button" size="sm" className="gg-mylists-pill" aria-haspopup="dialog" aria-label={WISH.myListsOpen(text)} onClick={() => openMyLists(null)} data-mylists-pill="">
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
.gg-savefor-nm .gg-savefor-on{color:hsl(var(--bark));font-weight:600}
`;
