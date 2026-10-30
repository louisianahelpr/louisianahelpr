import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { useState } from "react";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Check, Columns2 } from "lucide-react";
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
        className="h-4 w-4 min-h-0 min-w-0"
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
 * A pill chip with a selected state (aria-pressed; selected wears the shared btn-grad-primary, toggled in JS), its
 * tap target the full 44px button around a 32px visual pill. Below 360px the word hides and the icon carries it
 * (the name keeps its room); the accessible name is always "Compare <name>". Disabled once 3 are picked, unless
 * this one is. Guard: src/test/applicantCardCompareUpTop.test.tsx.
 */
export function CompareChip({ id, name, ids, toggle }: { id: string; name: string; ids: string[]; toggle: (id: string) => void }) {
  const on = ids.includes(id);
  const full = !on && ids.length >= COMPARE_MAX;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`Compare ${name}`}
      disabled={full}
      onClick={() => toggle(id)}
      className="group inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full -my-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:opacity-50"
      data-compare-chip=""
    >
      <span
        className={`inline-flex h-8 items-center gap-1 rounded-full px-2.5 font-sans text-ds-12 font-semibold ${on ? "btn-grad-primary" : "border border-border bg-card"}`}
        style={on ? { color: "hsl(var(--parchment))" } : { color: "hsl(var(--foreground))" }}
      >
        {on ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />}
        <span className="max-[359px]:sr-only">Compare</span>
      </span>
    </button>
  );
}

type DistanceOf = (app: EnrichedApplication) => string | null;

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
  const rows: { label: string; value: (a: EnrichedApplication) => string }[] = [
    { label: "Rating", value: (a) => ((a.reviewCount ?? 0) > 0 ? `${(a.avgRating ?? 0).toFixed(1)} from ${a.reviewCount}` : "No reviews yet") },
    { label: "ID checked", value: (a) => (a.profiles?.is_id_verified === true ? "Yes" : idOn ? "Not yet" : "No") },
    { label: "Can be hired now", value: (a) => (a.profiles?.is_payout_ready === true ? "Yes" : "Payout setup not finished") },
    { label: "Distance", value: (a) => distanceOf(a) ?? "—" },
    { label: "Their note", value: (a) => (a.message && !a.flagged_hidden ? `"${a.message}"` : "—") },
  ];
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left text-ds-13">
              <thead>
                <tr>
                  <th className="w-28 py-2" />
                  {picked.map((a) => (
                    <th key={a.id} scope="col" className="py-2 pr-3 text-ds-15 font-bold">{name(a)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-border align-top">
                    <th scope="row" className="py-2 pr-3 font-semibold text-muted-foreground">{r.label}</th>
                    {picked.map((a) => (
                      <td key={a.id} className="py-2 pr-3">{r.value(a)}</td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-border">
                  <th scope="row" className="py-2 pr-3" />
                  {picked.map((a) => (
                    <td key={a.id} className="py-2 pr-3">
                      <Button
                        variant="outline"
                        className="w-full rounded-full"
                        onClick={() => {
                          setOpen(false);
                          clear();
                          onHire(a);
                        }}
                      >
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
