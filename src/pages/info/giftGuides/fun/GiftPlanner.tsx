import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuthReady } from "@/hooks/useAuthReady";
import { FUN_WORDS as W, dollars, parseDollars, personMoney, planMoney, type PlanPerson } from "@/content/giftGuideFun1120";
import { useGiftList } from "../giftList";
import { Hint } from "../GiftHint";
import { FunPage } from "./FunPage";
import { planActions as A, useAccountSync, usePlan } from "./plannerStore";

/**
 * /gift-guides/planner (owner 2026-11-20): the people you're shopping for (a name only), a budget each, gift ideas
 * (typed, or from the wish list), Bought marks, and spent vs budget per person and in total. Saved on this device, and
 * on the account when signed in (plannerStore). Private: nothing here is shared. Guard: src/test/giftGuideFun1120.test.tsx.
 */
const PATH = "/gift-guides/planner" as const;

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
  const [idea, setIdea] = useState("");
  const [price, setPrice] = useState("");
  const [budgetText, setBudgetText] = useState(p.budget !== undefined ? String(p.budget) : "");
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const list = useGiftList();
  const addIdea = (e: FormEvent) => {
    e.preventDefault();
    if (!idea.trim()) return;
    const v = price.trim() ? parseDollars(price) : undefined;
    if (price.trim() && v === undefined) return setErr(W.plannerBadAmount);
    setErr(null);
    A.addIdea(p.id, { name: idea.trim(), ...(v !== undefined ? { price: v } : {}) });
    setIdea("");
    setPrice("");
  };
  const saveBudget = () => {
    if (!budgetText.trim()) return A.setBudget(p.id, undefined);
    const v = parseDollars(budgetText);
    if (v === undefined) return setErr(W.plannerBadAmount);
    setErr(null);
    A.setBudget(p.id, v);
  };
  return (
    <li className="gg-plan-person" data-plan-person={p.id}>
      <div className="gg-plan-head">
        <input aria-label={W.plannerPersonName} value={p.name} maxLength={40} onChange={(e) => A.renamePerson(p.id, e.target.value)} data-plan-name={p.id} />
        <input className="gg-plan-budget" aria-label={`${W.plannerBudget} (${p.name})`} placeholder={W.plannerBudget} inputMode="decimal" value={budgetText}
          onChange={(e) => setBudgetText(e.target.value)} onBlur={saveBudget} data-plan-budget={p.id} />
        <button type="button" className="gg-fun-x" aria-label={W.plannerRemovePerson(p.name)} onClick={() => A.removePerson(p.id)} data-plan-remove={p.id}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <MoneyBar p={p} />
      {p.ideas.length > 0 && (
        <ul className="gg-fun-list mt-2" aria-label={`${W.plannerIdeas} (${p.name})`}>
          {p.ideas.map((i) => (
            <li key={i.id} className={i.bought ? "gg-plan-idea bought" : "gg-plan-idea"} data-plan-idea={i.id}>
              <input type="checkbox" checked={i.bought} aria-label={`${W.plannerBought}: ${i.name}`} onChange={(e) => A.setIdea(p.id, i.id, { bought: e.target.checked })} data-plan-bought={i.id} />
              <span className="gg-plan-iname">{i.href ? <a href={i.href} target="_blank" rel="sponsored noopener" className="gg-link min-h-0">{i.name}</a> : i.name}</span>
              <input className="gg-plan-price" aria-label={`${W.plannerIdeaPrice}: ${i.name}`} inputMode="decimal" placeholder="$" defaultValue={i.price !== undefined ? String(i.price) : ""}
                onBlur={(e) => {
                  const t = e.target.value.trim();
                  const v = t ? parseDollars(t) : undefined;
                  if (t && v === undefined) return setErr(W.plannerBadAmount);
                  setErr(null);
                  A.setIdea(p.id, i.id, { price: v });
                }} data-plan-price={i.id} />
              <button type="button" className="gg-fun-x" aria-label={W.plannerRemoveIdea(i.name)} onClick={() => A.removeIdea(p.id, i.id)}>
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="gg-fun-row mt-2" onSubmit={addIdea}>
        <input aria-label={`${W.plannerIdeaName} (${p.name})`} placeholder={W.plannerIdeaName} value={idea} maxLength={120} onChange={(e) => setIdea(e.target.value)} data-plan-idea-name={p.id} />
        <input className="gg-plan-price" aria-label={`${W.plannerIdeaPrice} (${p.name})`} placeholder={W.plannerIdeaPrice} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-plan-idea-price={p.id} />
        <Button type="submit" variant="outline" size="sm" data-plan-add-idea={p.id}>{W.plannerAddIdea}</Button>
      </form>
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
  const [name, setName] = useState("");
  const total = planMoney(plan);
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    A.addPerson(name.trim());
    setName("");
  };
  return (
    <FunPage title={W.plannerTitle} path={PATH}>
      <h2>{W.plannerTitle}</h2>
      <p className="gg-fun-lead">{W.plannerLead}</p>
      <Hint id="fun-planner">{W.hintPlanner}</Hint>
      {plan.people.length > 0 && (
        <div className="gg-fun-card" aria-labelledby="plan-totals" data-plan-totals="">
          <p id="plan-totals" className="gg-finder-q m-0 mb-2">{W.plannerTotals}</p>
          <div className="gg-plan-totals">
            <div><b data-plan-total-budget="">{dollars(total.budget)}</b><span>{W.plannerTotalBudget}</span></div>
            <div><b data-plan-total-spent="">{dollars(total.spent)}</b><span>{W.plannerTotalSpent}</span></div>
            <div><b data-plan-total-left="" className={total.over ? "text-[#b26862]" : ""}>{dollars(total.left)}</b><span>{W.plannerTotalLeft}</span></div>
          </div>
          <p className="gg-fun-note text-center">{W.plannerTotalBought(total.bought, total.ideas)}</p>
        </div>
      )}
      {plan.people.length === 0 && <p className="gg-fun-note" data-plan-empty="">{W.plannerEmpty}</p>}
      <ul className="gg-fun-list">{plan.people.map((p) => <Person key={p.id} p={p} />)}</ul>
      <form className="gg-fun-row mt-3" onSubmit={add}>
        <input aria-label={W.plannerPersonName} placeholder={W.plannerPersonName} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} data-plan-new-name="" />
        <Button type="submit" className="btn-grad-primary" data-plan-add-person="">{W.plannerAddPerson}</Button>
      </form>
      <p className="gg-fun-note" data-plan-sync={sync}>
        {sync === "account" ? W.plannerSavedAccount : W.plannerSaved}{" "}
        {!user && <Link to="/login" className="gg-link min-h-0">{W.plannerSignIn}</Link>}
      </p>
      <Button asChild variant="link" size="inline" className="gg-link"><Link to="/gift-guides/swipe">{W.plannerFindGifts} ›</Link></Button>
    </FunPage>
  );
}
