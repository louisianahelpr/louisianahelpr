import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuthReady } from "@/hooks/useAuthReady";
import { track } from "@/lib/analytics";
import { FUN_WORDS as W, dollars, parseDollars, personMoney, planMoney, type PlanPerson } from "@/content/giftGuideFun1120";
import { useGiftList } from "../giftList";
import { Hint } from "../GiftHint";
import { FunBody, funHeader } from "./FunPage";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { planActions as A, useAccountSync, usePlan } from "./plannerStore";
import { PriceAlertsOptIn } from "./PriceAlertsOptIn";
import { PRINTABLES, PRINTABLES_PATH, isShown } from "@/content/printables";
import { storeOf } from "@/content/giftGuideCatalog";
import { PickThumb } from "../GiftGuideView";
import { GiftOut } from "../GiftOut";
import { GuidePicksPicker, type GuidePick } from "./GuidePicksPicker";
import { plannerPrice, shareListOf } from "../saveForPeople";
import { ShareAllLists } from "../SaveForSomeone";
import { AmazonCartForList } from "../AmazonCartButton";
import { AnyStoreAdd } from "../AnyStoreAdd";
import { useOurLinkSync } from "../wishLinkSync";
import { ListLine } from "../ManageList";
import { GiftWishShare } from "../GiftWishShare";
import { WISH } from "@/content/giftWishList";
import { shareGiftLists } from "@/lib/giftWishListApi";

/**
 * /gift-guides/planner (owner 2026-11-20): the people you're shopping for (a name only), a budget each, gift ideas
 * (typed, from the wish list, or from our guides: GuidePicksPicker, owner 11-21), Bought marks, and spent vs budget per person and in total. Saved on this device, and
 * on the account when signed in (plannerStore). Private: nothing here is shared. Guard: src/test/giftGuideFun1120.test.tsx.
 */
const PATH = "/gift-guides/planner" as const;
const PLANNER_SHEET = PRINTABLES.find((p) => p.id === "gift-planner-sheet");

function MoneyBar({ p }: { p: PlanPerson }) {
  const m = personMoney(p);
  if (p.budget === undefined && m.spent === 0) return null;
  const pct = m.budget > 0 ? Math.min(100, Math.round((m.spent / m.budget) * 100)) : 100;
  return (
    <>
      {p.budget !== undefined && (
        <div className="gg-plan-bar" role="progressbar" aria-valuemin={0} aria-valuemax={m.budget} aria-valuenow={m.spent} aria-label={W.plannerSpentOf(dollars(m.spent), dollars(m.budget))}>
          <i className={m.over ? "over" : ""} style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="gg-plan-money m-0" data-plan-money={p.id}>
        <span>{p.budget !== undefined ? W.plannerSpentOf(dollars(m.spent), dollars(m.budget)) : W.plannerSpent(dollars(m.spent))}</span>
        {p.budget !== undefined && (m.over ? <span className="over">{W.plannerOver(dollars(-m.left))}</span> : <span>{W.plannerLeft(dollars(m.left))}</span>)}
      </p>
    </>
  );
}

function Person({ p }: { p: PlanPerson }) {
  const [budgetText, setBudgetText] = useState(p.budget !== undefined ? String(p.budget) : "");
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [fromGuides, setFromGuides] = useState(false);
  const list = useGiftList();
  const added = new Set(p.ideas.flatMap((i) => (i.href ? [i.href] : [])));
  // Owner 11-21: a guide pick comes in with its name, the price its guide shows, its shop link and its photo.
  const addPick = (g: GuidePick) => {
    if (added.has(g.href)) return;
    const price = plannerPrice(g);
    A.addIdea(p.id, { name: g.name, href: g.href, guide: g.guide, ...(price !== undefined ? { price } : {}), ...(g.image ? { image: g.image } : {}) });
  };
  // UX audit M2: the budget saves as it is typed (when it is an amount); a typed non-amount says so at once.
  const typeBudget = (text: string) => {
    setBudgetText(text);
    if (!text.trim()) {
      setErr(null);
      return A.setBudget(p.id, undefined);
    }
    const v = parseDollars(text);
    if (v === undefined) return setErr(W.plannerBadAmount);
    setErr(null);
    A.setBudget(p.id, v);
  };
  return (
    <li className="gg-plan-person" data-plan-person={p.id}>
      <div className="gg-plan-head">
        <Input aria-label={W.plannerPersonName} value={p.name} maxLength={40} onChange={(e) => A.renamePerson(p.id, e.target.value)}
          onBlur={() => { if (!p.name.trim()) A.renamePerson(p.id, W.plannerUnnamed); }} data-plan-name={p.id} />
        <Input className="gg-plan-budget" aria-label={`${W.plannerBudget} (${p.name})`} placeholder={W.plannerBudget} inputMode="decimal" value={budgetText}
          onChange={(e) => typeBudget(e.target.value)} data-plan-budget={p.id} />
        <RoundIconButton className="gg-fun-x" aria-label={W.plannerRemovePerson(p.name)} onClick={() => A.removePerson(p.id)} data-plan-remove={p.id}>
          <span aria-hidden="true">×</span>
        </RoundIconButton>
      </div>
      {/* Owner 11-21: the list's gifts and total against the budget, as in the guides' sheet ("$36.75 left of $100"). */}
      {p.ideas.length > 0 && <p className="gg-plan-money m-0" data-plan-list-line={p.id}><ListLine p={p} /></p>}
      <MoneyBar p={p} />
      {p.ideas.length > 0 && (
        <ul className="gg-fun-list mt-2" aria-label={`${W.plannerIdeas} (${p.name})`}>
          {p.ideas.map((i) => (
            <li key={i.id} className={i.bought ? "gg-plan-idea bought" : "gg-plan-idea"} data-plan-idea={i.id}>
              <label className="gg-plan-check h-11 w-11">
                <Checkbox checked={i.bought} aria-label={`${W.plannerBought}: ${i.name}`} onCheckedChange={(v) => A.setIdea(p.id, i.id, { bought: v === true })} data-plan-bought={i.id} />
              </label>
              {i.image && <PickThumb pick={{ name: i.name, href: i.href ?? "", store: i.href ? storeOf(i.href) : "", image: i.image }} size={40} />}
              <span className="gg-plan-iname">
                <span className="gg-plan-iname-t">{i.name}</span>
                {/* Owner 11-21: an idea with a shop link says "Shop", so Bought and Shop both work from the planner. */}
                {i.href && (
                  <GiftOut href={i.href} className="gg-link gg-plan-shop">
                    <span data-plan-shop={i.id}>{W.plannerShop}</span><span aria-hidden="true">&nbsp;›</span>
                    <span className="sr-only"> {i.name}, opens in a new tab</span>
                  </GiftOut>
                )}
              </span>
              <Input className="gg-plan-price" aria-label={`${W.plannerIdeaPrice}: ${i.name}`} inputMode="decimal" placeholder="$" defaultValue={i.price !== undefined ? String(i.price) : ""}
                onBlur={(e) => {
                  const t = e.target.value.trim();
                  const v = t ? parseDollars(t) : undefined;
                  if (t && v === undefined) return setErr(W.plannerBadAmount);
                  setErr(null);
                  A.setIdea(p.id, i.id, { price: v });
                }} data-plan-price={i.id} />
              <RoundIconButton className="gg-fun-x" aria-label={W.plannerRemoveIdea(i.name)} onClick={() => A.removeIdea(p.id, i.id)}>
                <span aria-hidden="true">×</span>
              </RoundIconButton>
            </li>
          ))}
        </ul>
      )}
      {/* Owner 11-21 ("someone can just type in ideas ... and we find a link or closest match"): the one Gift idea box
          takes a typed idea or a pasted link from any store; a price goes on the idea's own row once it is added. */}
      <AnyStoreAdd person={p} extra={
        <Button type="button" variant="outline" size="sm" aria-haspopup="dialog" onClick={() => setFromGuides(true)} data-plan-from-guides={p.id}>{W.plannerFromGuides}</Button>
      } />
      {/* Owner 11-21 (Amazon Buy Now): every Amazon gift on this list in one add-to-cart link. */}
      <AmazonCartForList person={p} />
      {/* Owner 11-21 ("share all lists"): this person's list as a link (names and gifts from our guides only). */}
      {shareListOf(p).items.length > 0 && (
        <GiftWishShare name={p.name} refs={shareListOf(p).items} label={WISH.shareThisList} message={WISH.shareListsMessage} hint={false} quiet save={() => shareGiftLists([shareListOf(p)])} />
      )}
      <GuidePicksPicker open={fromGuides} onOpenChange={setFromGuides} personName={p.name} added={added} onPick={addPick} />
      {list.picks.length > 0 && (
        <Button type="button" variant="link" size="inline" className="gg-link" aria-expanded={picking} onClick={() => setPicking((v) => !v)} data-plan-from-list={p.id}>{W.plannerFromList}</Button>
      )}
      {picking && (
        <ul className="gg-fun-list">
          {list.picks.map((s) => (
            <li key={s.href}>
              <Button type="button" variant="outline" size="sm" className="h-auto whitespace-normal text-left"
                onClick={() => { A.addIdea(p.id, { name: s.name, href: s.href, ...(s.guide ? { guide: s.guide } : {}), ...(s.id ? { item: s.id } : {}) }); setPicking(false); }}>
                + {s.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="gg-fun-err" role="alert">{err}</p>}
    </li>
  );
}

export default function GiftPlanner() {
  const plan = usePlan();
  const { user, isReady } = useAuthReady();
  const sync = useAccountSync(user?.id ?? null, isReady);
  // Owner 11-21: gifts from any store switch to our link once we made it (never before the account's plan is merged).
  useOurLinkSync(plan, isReady && (!user || sync !== "device"));
  const [name, setName] = useState("");
  const total = planMoney(plan);
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    A.addPerson(name.trim());
    track("gift_planner_person_added", { people: plan.people.length + 1 });
    setName("");
  };
  return (
    <PublicHeaderPage {...funHeader(W.plannerTitle)}>
      <FunBody title={W.plannerTitle} path={PATH}>
      <p className="gg-fun-lead">{W.plannerLead}</p>
      <Hint id="fun-planner">{W.hintPlanner}</Hint>
      {plan.people.length > 0 && (
        <div className="gg-fun-card" aria-labelledby="plan-totals" data-plan-totals="">
          <p id="plan-totals" className="gg-finder-q m-0 mb-2">{W.plannerTotals}</p>
          <div className="gg-plan-totals">
            <div><b data-plan-total-budget="">{dollars(total.budget)}</b><span>{W.plannerTotalBudget}</span></div>
            <div><b data-plan-total-spent="">{dollars(total.spent)}</b><span>{W.plannerTotalSpent}</span></div>
            {total.over ? (
              <div><b data-plan-total-left="" className="text-[#b26862]">{dollars(-total.left)}</b><span>{W.plannerTotalOver}</span></div>
            ) : (
              <div><b data-plan-total-left="">{dollars(total.left)}</b><span>{W.plannerTotalLeft}</span></div>
            )}
          </div>
          <p className="gg-fun-note text-center">{W.plannerTotalBought(total.bought, total.ideas)}</p>
        </div>
      )}
      {plan.people.length === 0 && <p className="gg-fun-note" data-plan-empty="">{W.plannerEmpty}</p>}
      <ul className="gg-fun-list">{plan.people.map((p) => <Person key={p.id} p={p} />)}</ul>
      <ShareAllLists plan={plan} />
      <form className="gg-fun-row mt-3" onSubmit={add}>
        <Input aria-label={W.plannerPersonName} placeholder={W.plannerPersonName} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-plan-new-name="" />
        <Button type="submit" className="btn-grad-primary" data-plan-add-person="">{W.plannerAddPerson}</Button>
      </form>
      {/* Saved-gift price alerts (owner 2026-11-21): the opt-in under the lists, once there is someone on them. */}
      {plan.people.length > 0 && <PriceAlertsOptIn />}
      <p className="gg-fun-note" data-plan-sync={sync}>
        {sync === "account" ? W.plannerSavedAccount : W.plannerSaved}{" "}
        {!user && <Link to="/login" className="gg-link">{W.plannerSignIn}</Link>}
      </p>
      <Link to="/gift-guides/swipe" className="gg-link">{W.plannerFindGifts} ›</Link>
      {/* Owner 2026-11-20: the printable gift list and budget sheet, once the owner's file is in (src/content/printables.ts). */}
      {PLANNER_SHEET && isShown(PLANNER_SHEET) && (
        <Button asChild variant="link" size="inline" className="gg-link"><Link to={`${PRINTABLES_PATH}#${PLANNER_SHEET.id}`} data-plan-printable="">{PLANNER_SHEET.title} ›</Link></Button>
      )}
      </FunBody>
    </PublicHeaderPage>
  );
}
