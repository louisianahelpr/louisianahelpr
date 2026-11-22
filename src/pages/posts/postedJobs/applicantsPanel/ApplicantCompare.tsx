import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { useState } from "react";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Columns2 } from "lucide-react";
import { IconActionButton } from "@/components/dashboard/IconActionButton";
import { formatName } from "@/lib/utils";
import type { EnrichedApplication } from "@/components/job-card/activityConstants";

/**
 * Boards 22 (phone) and 170 (desktop): pick 2 or 3 applicants and compare them
 * side by side, then hire from the comparison (spec §10 "Compare 2–3 side by
 * side"). Every row is a fact the applicant card already shows, read from the
 * same application row: public rating with its count, ID check, payout setup,
 * distance band and their note. A fact the row does not have is "—", never a
 * guess. Hiring goes through the card's own onAcceptApplication, so the hire
 * flow (and its payout gate) is exactly the card's. Never the Helpr's
 * take-home (poster screen, checkoutNoHelperPayLine).
 */
const COMPARE_MAX = 3;

export function useApplicantCompare() {
  const [ids, setIds] = useState<string[]>([]);
  const toggle = (id: string) =>
    setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= COMPARE_MAX ? cur : [...cur, id]));
  return { ids, toggle, clear: () => setIds([]) };
}

/** The desktop table's "Compare" tick (the phone card uses CompareChip). Disabled once 3 are picked, unless this one is. `labelHidden`: the desktop table's column header already says Compare (board 170). */
export function CompareCheck({ id, name, ids, toggle, labelHidden }: { id: string; name: string; ids: string[]; toggle: (id: string) => void; labelHidden?: boolean }) {
  const on = ids.includes(id);
  const full = !on && ids.length >= COMPARE_MAX;
  return (
    <label className={`inline-flex min-h-11 items-center gap-2 text-ds-13 font-semibold ${full ? "text-muted-foreground" : "text-foreground"}`}>
      <input
        type="checkbox"
        className="h-[18px] w-[18px] min-h-0 min-w-0"
        style={{ accentColor: "hsl(var(--primary))" }}
        checked={on}
        disabled={full}
        onChange={() => toggle(id)}
        aria-label={`Compare ${name}`}
      />
      <span className={labelHidden ? "sr-only" : undefined}>Compare</span>
    </label>
  );
}

/**
 * The phone/tablet card's Compare toggle, in the card's top-right icon row LEFT of the private-note icon (owner,
 * 2026-10-29, iPhone Applicants screenshot: Compare had a row of its own under Hire, making every card taller).
 * Owner's pick (option B with a change, 2026-10-29 mockup): a PLAIN icon exactly like the note, flag and block icons
 * beside it (the same shared IconActionButton, bare and compact: no circle, no border, the same size and tap area).
 * Picked shows as the icon turning olive (--bark) with an olive tint inside, never a ring; aria-pressed and the
 * name "Compare <name>" carry it for screen readers. Disabled once 3 are picked, unless this one is.
 * Guard: src/test/applicantCardCompareUpTop.test.tsx.
 */
export function CompareChip({ id, name, ids, toggle }: { id: string; name: string; ids: string[]; toggle: (id: string) => void }) {
  const on = ids.includes(id);
  const full = !on && ids.length >= COMPARE_MAX;
  return (
    <IconActionButton
      // Jobs audit 11-21 (G10): 44px, as the "..." menu beside it (it was 32px, matching the icons the menu replaced).
      bare
      icon={<Columns2 className="w-4 h-4" style={on ? { fill: "hsl(var(--bark) / 0.22)" } : undefined} aria-hidden="true" />}
      ariaLabel={`Compare ${name}`}
      ariaPressed={on}
      pressed={on}
      pressedColor="hsl(var(--bark))"
      disabled={full}
      onClick={() => toggle(id)}
    />
  );
}

type DistanceOf = (app: EnrichedApplication) => string | null;

/** Payout setup is the Helpr's step at THEIR accept (20261003193541); a poster can always send the offer. */
const PAYOUT_NOT_YET = "Not yet. You can still hire";
const NONE = "—";

/**
 * The compare sheet's rows (Jobs audit 11-21, G11). "Can be hired now: Payout setup not finished" sat over a Hire button
 * that works (a single job's Hire is an offer; the payout gate is at the Helpr's accept), so the row says what it is:
 * "Payout set up: Not yet. You can still hire". A row with nothing for anyone picked (Distance all dashes when no
 * distance is known, no notes) is left out instead of a line of dashes.
 */
function compareRows(picked: EnrichedApplication[], { idOn, distanceOf }: { idOn: boolean; distanceOf: DistanceOf }) {
  const rows: { label: string; value: (a: EnrichedApplication) => string }[] = [
    { label: "Rating", value: (a) => ((a.reviewCount ?? 0) > 0 ? `${(a.avgRating ?? 0).toFixed(1)} from ${a.reviewCount}` : "No reviews yet") },
    { label: "ID checked", value: (a) => (a.profiles?.is_id_verified === true ? "Yes" : idOn ? "Not yet" : "No") },
    { label: "Payout set up", value: (a) => (a.profiles?.is_payout_ready === true ? "Yes" : PAYOUT_NOT_YET) },
    { label: "Distance", value: (a) => distanceOf(a) ?? NONE },
    { label: "Their note", value: (a) => (a.message && !a.flagged_hidden ? `"${a.message}"` : NONE) },
  ];
  return rows.filter((r) => picked.some((a) => r.value(a) !== NONE));
}

/** The sticky bar once 2+ are picked, and the side-by-side sheet it opens. */
export function CompareBar({
  apps,
  ids,
  clear,
  distanceOf,
  onHire,
  barClassName,
}: {
  apps: EnrichedApplication[];
  ids: string[];
  clear: () => void;
  distanceOf: DistanceOf;
  onHire: (app: EnrichedApplication) => void;
  /** Extra classes on the bar: the desktop table hides it where its side card shows (board 170). */
  barClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  // "Not yet" promises a check; with the ID check off (owner 2026-10-23) it is a plain "No".
  const idOn = useIdentityCheckOnStore();
  const picked = ids.map((id) => apps.find((a) => a.id === id)).filter((a): a is EnrichedApplication => !!a);
  if (picked.length < 2) return null;
  const name = (a: EnrichedApplication) => formatName(a.profiles?.full_name, "Helpr");
  const rows = compareRows(picked, { idOn, distanceOf });
  const hire = (a: EnrichedApplication) => {
    setOpen(false);
    clear();
    onHire(a);
  };
  return (
    <>
      <div className={`sticky bottom-safe-nav z-10 flex items-center justify-between gap-3 rounded-full border border-border bg-card px-4 py-2 shadow-[var(--card-shadow)] ${barClassName ?? ""}`} data-compare-bar="">
        <span className="text-ds-14 font-semibold">{picked.length} selected</span>
        <Button variant="primary" className="rounded-full" onClick={() => setOpen(true)}>Compare side by side</Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          onOpenAutoFocus={(event) => {
            // A hire button is one tap from a hire: the sheet, not a Hire, takes the initial focus.
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
          }}
        >
          <SheetHero title={`Comparing ${picked.length}`} />
          {/* Jobs audit 11-21 (G11): on a phone the side-by-side table ran off the right edge (min-w-[420px] in a 375 sheet:
              "No reviews...", "Payout set..." and the second Hire clipped, no scroll cue). Below sm each applicant is a
              card of its own, stacked; from sm the table fits and stays. */}
          <div className="space-y-3 sm:hidden" data-compare-cards="">
            {picked.map((a) => (
              <section key={a.id} className="rounded-2xl border border-border p-4" aria-label={name(a)}>
                <h3 className="text-ds-15 font-bold">{name(a)}</h3>
                <dl className="mt-2 space-y-1.5 text-ds-13">
                  {rows.map((r) => (
                    <div key={r.label} className="flex items-baseline justify-between gap-3">
                      <dt className="shrink-0 font-semibold text-muted-foreground">{r.label}</dt>
                      <dd className="min-w-0 text-right [overflow-wrap:anywhere]">{r.value(a)}</dd>
                    </div>
                  ))}
                </dl>
                <Button variant="outline" className="mt-3 w-full rounded-full" onClick={() => hire(a)}>
                  Hire {name(a).split(" ")[0]}
                </Button>
              </section>
            ))}
          </div>
          <div className="hidden sm:block">
            <table className="w-full table-fixed border-collapse text-left text-ds-13">
              <thead>
                <tr>
                  <th className="w-32 py-2" />
                  {picked.map((a) => (
                    <th key={a.id} scope="col" className="py-2 pr-3 text-ds-15 font-bold [overflow-wrap:anywhere]">{name(a)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-border align-top">
                    <th scope="row" className="py-2 pr-3 font-semibold text-muted-foreground">{r.label}</th>
                    {picked.map((a) => (
                      <td key={a.id} className="py-2 pr-3 [overflow-wrap:anywhere]">{r.value(a)}</td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-border">
                  <th scope="row" className="py-2 pr-3" />
                  {picked.map((a) => (
                    <td key={a.id} className="py-2 pr-3">
                      <Button variant="outline" className="w-full rounded-full" onClick={() => hire(a)}>
                        Hire {name(a).split(" ")[0]}
                      </Button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Board 173: "Show 10 more" (or fewer at the end) under a long applicant list; nothing when all are shown. */
export function ShowMoreApplicants({ total, shown, onMore }: { total: number; shown: number; onMore: () => void }) {
  const left = total - shown;
  if (left <= 0) return null;
  return (
    <Button type="button" variant="ghost" className="mx-auto block" onClick={onMore}>
      Show {Math.min(10, left)} more
    </Button>
  );
}
