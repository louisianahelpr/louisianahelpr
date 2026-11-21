import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { guidePicksVersion, loadGuidePicks, subscribeGuidePicks } from "@/content/giftGuideCatalog";
import { OWNER_LIST_GUIDES } from "@/content/giftGuidePeople.mjs";
import { WISH } from "@/content/giftWishList";
import type { PlanPerson } from "@/content/giftGuideFun1120";
import { PickPrice } from "@/components/giftGuides/PickPrice";
import { closestPicks, nameFromLink, ourLink, pastedLink, type OurLink } from "@/lib/wishLinks";
import { planActions } from "./fun/plannerStore";
import { livePicks, type GuidePick } from "./fun/GuidePicksPicker";
import { PickThumb } from "./GiftGuideView";
import { saveItemOf } from "./saveForPeople";

/**
 * "Add from any store" on a person's list (owner 2026-11-21): paste a product link or type an idea.
 *   - A link to a product our guides carry goes on as that pick (our link, its photo and price).
 *   - Another Amazon product goes on with our Amazon link (amazon.com/dp/<ASIN>, our tag), named from its link.
 *   - Any other shop's link goes on as typed, named from its link (the shopper can change the name first).
 *   - Typed words show up to 3 of our closest picks to choose from, or "Add my words" keeps the idea as typed; with no
 *     close pick the words go straight on.
 *   - `extra`: buttons in the same row (the planner's "From our guides").
 * Nothing is fetched or opened (src/lib/wishLinks.ts). Guard: src/test/wishAnyLink1121.test.tsx.
 */
export function AnyStoreAdd({ person, disabled = false, extra }: { person: PlanPerson; disabled?: boolean; extra?: ReactNode }) {
  const [text, setText] = useState("");
  const [link, setLink] = useState<Exclude<OurLink, { kind: "pick" }> | null>(null);
  const [name, setName] = useState("");
  const [matches, setMatches] = useState<GuidePick[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const version = useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  useEffect(() => {
    Promise.all(OWNER_LIST_GUIDES.map((s) => loadGuidePicks(s))).catch((e: unknown) => {
      // Matching to our picks is a help, not a need: without them a link or idea still goes on as typed.
      console.warn("any-store add: guide picks failed to load", e);
    });
  }, []);
  const picks = useMemo(() => (version >= 0 ? livePicks() : []), [version]);
  const full = person.ideas.length >= 30;
  const reset = (said: string) => {
    setText("");
    setLink(null);
    setName("");
    setMatches(null);
    setNote(said);
  };
  const addPick = (p: GuidePick) => {
    if (!person.ideas.some((i) => i.href === p.href)) planActions.addIdea(person.id, saveItemOf(p, p.guide));
    reset(WISH.anyAdded(p.name));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || disabled || full) return;
    setNote(null);
    const u = pastedLink(t);
    if (u) {
      const our = ourLink(u, picks);
      if (our.kind === "pick") return addPick(our.pick as GuidePick);
      setLink(our);
      setName(nameFromLink(u));
      setMatches(null);
      return;
    }
    if (/^[a-z]+:/i.test(t) && !/\s/.test(t)) return setNote(WISH.anyBadLink);
    setLink(null);
    const close = closestPicks(t, picks, 3);
    if (close.length === 0) return addWords();
    setMatches(close);
  };
  const addLink = (e: FormEvent) => {
    e.preventDefault();
    if (!link || !name.trim()) return;
    planActions.addIdea(person.id, { name: name.trim().slice(0, 120), href: link.href });
    reset(WISH.anyAdded(name.trim()));
  };
  const addWords = () => {
    planActions.addIdea(person.id, { name: text.trim().slice(0, 120) });
    reset(WISH.anyAdded(text.trim()));
  };
  return (
    <div className="gg-anystore" data-anystore={person.id}>
      <style>{ANY_STORE_CSS}</style>
      <form className="gg-anystore-row" onSubmit={submit}>
        <Input aria-label={WISH.anyLabel(person.name)} placeholder={WISH.anyPlaceholder} value={text} maxLength={2000} disabled={disabled || full}
          onChange={(e) => { setText(e.target.value); setLink(null); setMatches(null); }} data-anystore-input={person.id} />
        <Button type="submit" variant="outline" size="sm" disabled={disabled || full || !text.trim()} data-anystore-go={person.id}>{WISH.anyGo}</Button>
        {extra}
      </form>
      {link && (
        <form className="gg-anystore-row" onSubmit={addLink} data-anystore-link={link.kind}>
          <Input aria-label={WISH.anyName} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-anystore-name="" />
          <Button type="submit" size="sm" className="btn-grad-primary" disabled={!name.trim()} data-anystore-add-link="">{WISH.anyAdd}</Button>
          <p className="gg-price-note">{link.kind === "amazon" ? WISH.anyAmazon : link.short ? WISH.anyShort : WISH.anyPlain}</p>
        </form>
      )}
      {matches && (
        <div data-anystore-matches="">
          <p className="gg-price-note">{WISH.anyClosest}</p>
          <ul className="gg-anystore-picks">
            {matches.map((p) => (
              <li key={p.href}>
                <Button type="button" variant="ghost" size="inline" className="gg-anystore-pick justify-start whitespace-normal text-left font-normal tracking-normal"
                  aria-label={WISH.anyPick(p.name)} onClick={() => addPick(p)} data-anystore-pick={p.href}>
                  <PickThumb pick={p} size={48} />
                  <span className="gg-anystore-nm"><span className="gg-anystore-name">{p.name}</span><small><PickPrice pick={p} /></small></span>
                  <span className="gg-anystore-plus" aria-hidden="true">+</span>
                </Button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="link" size="inline" className="gg-link" onClick={addWords} data-anystore-words="">{WISH.anyWords}</Button>
        </div>
      )}
      {note && <p className="gg-price-note" role="status">{note}</p>}
    </div>
  );
}

/** Its own small styles (it sits in the planner and in the guides' My lists panel, which load different CSS). */
const ANY_STORE_CSS = `
.gg-anystore{display:flex;flex-direction:column;gap:6px;margin:8px 0 0}
.gg-anystore-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.gg-anystore-row input{flex:1 1 180px;min-width:0;min-height:44px}
.gg-anystore-row .gg-price-note{flex:1 1 100%;margin:0}
.gg-anystore-picks{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:4px}
.gg-anystore-pick{display:flex;gap:10px;align-items:center;width:100%;min-height:56px;padding:6px;border:0;border-radius:12px;background:transparent;color:var(--gg-ink)}
.gg-anystore-pick:hover{background:hsl(var(--muted))}
.gg-anystore-pick .gg-photo,.gg-anystore-pick .gg-thumb{width:48px;height:48px;flex:none}
.gg-anystore-nm{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.gg-anystore-name{font-size:14px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gg-anystore-nm small{font-size:13px;color:var(--gg-muted)}
.gg-anystore-plus{flex:none;min-width:44px;text-align:center;font-size:22px;font-weight:600;color:var(--gg-olive)}
`;
