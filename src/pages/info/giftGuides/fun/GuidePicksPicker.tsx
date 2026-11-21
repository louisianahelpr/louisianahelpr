import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Dialog, DialogAcknowledgeAction, DialogContent, DialogFooter, DialogHero } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { guideBySlug, guidePicksVersion, loadGuidePicks, subscribeGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { OWNER_LIST_GUIDES, peopleGuideOf } from "@/content/giftGuidePeople.mjs";
import { FUN_WORDS as W } from "@/content/giftGuideFun1120";
import { PickPrice, showsPrice } from "@/components/giftGuides/PickPrice";
import { PickThumb } from "../GiftGuideView";

/**
 * The gift planner's "From our guides" picker (owner 2026-11-21, "let them add ideas from our guides"): the live
 * guides' picks (Her, Him, Kids: the owner's own lists, OWNER_LIST_GUIDES; their relationship pages show the same
 * picks), a search box and All / Her / Him / Kids chips. Each row is the pick's photo, name and price, as on the guide;
 * tapping it adds it to that person (name, price, shop link, photo) and the row then reads "Added". The shared Dialog is
 * a bottom sheet on a phone and a card on a desktop. Guard: src/test/plannerGuideIdeas1121.test.tsx.
 */
/** A live guide pick and its guide ("her", "him", "kids": OWNER_LIST_GUIDES). */
export type GuidePick = CatalogPick & { guide: string };
const LABELS: Record<string, string> = { her: "Her", him: "Him", kids: "Kids" };

/** The guide a person's name plainly names ("Her", "Mom", "Dad", "Husband", "Kids"), or null: never a guess. */
export function guideForName(name: string): string | null {
  const slug = name.trim().toLowerCase();
  const g = OWNER_LIST_GUIDES.includes(slug) ? slug : peopleGuideOf(slug);
  return g && OWNER_LIST_GUIDES.includes(g) ? g : null;
}

/** Every live guide's picks in guide order, each link once (the first guide that lists it keeps it). */
export function livePicks(): GuidePick[] {
  const seen = new Set<string>();
  return OWNER_LIST_GUIDES.flatMap((slug) => (guideBySlug(slug)?.picks ?? []).flatMap((p): GuidePick[] => {
    if (!p.href || !p.name || seen.has(p.href)) return [];
    seen.add(p.href);
    return [{ ...p, guide: slug }];
  }));
}

/** The picks a search keeps: every typed word in the name or the brand. */
const matchesSearch = (p: CatalogPick, query: string) => {
  const hay = `${p.name} ${p.brand ?? ""}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

/** The price a pick adds to the planner: the one its guide shows today, or none. */
export const pickPlannerPrice = (p: CatalogPick) => (showsPrice(p) ? p.price : undefined);

export function GuidePicksPicker({ open, onOpenChange, personName, added, onPick }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personName: string;
  /** The links already on this person's list (their rows read "Added"). */
  added: ReadonlySet<string>;
  onPick: (pick: GuidePick) => void;
}) {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const version = useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setOnly(guideForName(personName));
    setFailed(false);
    Promise.all(OWNER_LIST_GUIDES.map((s) => loadGuidePicks(s))).catch((e: unknown) => {
      console.warn("planner: guide picks failed to load", e);
      setFailed(true);
    });
    // Only on opening: a rename while it is open keeps the chip the person chose.
  }, [open]);
  // `version` moves when a guide's chunk lands, so the list is read again then.
  const all = useMemo(() => (version >= 0 ? livePicks() : []), [version]);
  const rows = all.filter((p) => (!only || p.guide === only) && matchesSearch(p, query));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-plan-picker="">
        <DialogHero title={W.plannerGuidesTitle(personName)} />
        <div className="gg gg-fun gg-plan-picker">
          <Input type="search" aria-label={W.plannerGuidesSearch} placeholder={W.plannerGuidesSearch} value={query} maxLength={60}
            onChange={(e) => setQuery(e.target.value)} data-plan-picker-search="" />
          <div className="gg-plan-picker-chips" role="group" aria-label={W.plannerFromGuides}>
            <ToggleChip pressed={only === null} onClick={() => setOnly(null)} data-plan-picker-chip="all">{W.plannerGuidesAll}</ToggleChip>
            {OWNER_LIST_GUIDES.map((g) => (
              <ToggleChip key={g} pressed={only === g} onClick={() => setOnly(g)} data-plan-picker-chip={g}>{LABELS[g] ?? g}</ToggleChip>
            ))}
          </div>
          {failed ? (
            <p className="gg-fun-err" role="alert">{W.plannerGuidesFailed}</p>
          ) : all.length === 0 ? (
            <p className="gg-fun-note" role="status">{W.plannerGuidesLoading}</p>
          ) : rows.length === 0 ? (
            <p className="gg-fun-note" role="status" data-plan-picker-none="">{W.plannerGuidesNone}</p>
          ) : (
            <ul className="gg-plan-picks" aria-label={W.plannerFromGuides}>
              {rows.map((p) => {
                const done = added.has(p.href);
                return (
                  <li key={p.href}>
                    <button type="button" className="gg-plan-pick" disabled={done} aria-label={done ? `${p.name}: ${W.plannerGuidesAdded}` : W.plannerGuidesAdd(p.name, personName)}
                      onClick={() => onPick(p)} data-plan-pick={p.href}>
                      <PickThumb pick={p} size={48} />
                      <span className="gg-plan-pick-nm">
                        <span className="gg-plan-pick-name">{p.name}</span>
                        <small><PickPrice pick={p} /></small>
                      </span>
                      <span className={done ? "gg-plan-pick-act" : "gg-plan-pick-act add"} aria-hidden="true">{done ? W.plannerGuidesAdded : "+"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <DialogAcknowledgeAction data-plan-picker-done="">{W.plannerGuidesDone}</DialogAcknowledgeAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
