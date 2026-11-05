import { Rocket, Zap, Star } from "lucide-react";
import { categoryLabels } from "@/components/job-card/activityConstants";
import { formatCategory } from "@/lib/format";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import type { EnrichedJob } from "../types";

/* Moved verbatim from JobDetailDialog.tsx (Q806 god-component ratchet, a pure move: the sheet's DOM is byte-identical). */

export function JobDetailBadgeRow({ job, isRecommended, railIsCrowded, iconLaneReservePx }: {
  job: EnrichedJob;
  isRecommended: boolean;
  railIsCrowded: boolean;
  iconLaneReservePx: number;
}) {
  return (
    <>
        {/* ── FRAME CHROME, RENDERED AFTER THE HERO ─────────────────────────
            NOTHING RENDERS ABOVE THE HERO (dialog.tsx, "THE POPUP GRAMMAR").
            These two elements used to be the first children of DialogContent,
            which is what held this file out of the 2026-08-31 popup-grammar
            pass: the rule exists because the one dialog that put a 56px icon
            tile above its title pushed the title off the row the X is aligned
            to, and a reader opening a popup should meet its title first.
            They come AFTER the Hero in the DOM now — which is what they are:
            card chrome, not header content. Both carry
            `data-frame-chrome` and both bleed into the p-4/p-5 gutter (the
            rail is `absolute`; the badge row cancels the padding with negative
            margins), neither is in the reading stack, and a screen reader now
            gets "<job title>" before "Home Repair · Urgent · Boosted" rather
            than after — the better order of the two.
            The badge row takes `order-first` to stay the top-left corner tab
            the owner asked for ("category top left"). `order` is safe here and
            nowhere near the WCAG 2.4.3 problem the footer has: this row holds
            nothing focusable (it is `pointer-events-none`), so there is no
            focus order to mismatch, and the reading order it produces is the
            sensible one. It is also the ONLY way to keep both halves — the
            corner tab AND a Hero with nothing above it — without going back to
            `absolute`, which is the defect below.
            The alternative considered and rejected: moving the strip visually
            BELOW the title. That deletes an owner-approved design element
            (the flush corner tab) to satisfy a rule aimed at icon tiles in the
            header stack, so the strip stays where the owner put it and only
            its DOM position changes.

            The category chip is rendered as its own element rather than
            passed to DialogHero as an
            `eyebrow`: DialogHero accepts that prop but deliberately does not
            render it (the 2026-07-25 "one main title" decision), so the
            category this dialog used to pass was silently discarded. The
            browse card leads with the category — it is the first thing a
            helpr filters on — and opening the job dropped it entirely. Same
            dot + icon + label treatment as the feed card so the two read as
            the same object. */}
        {/* Category — top-LEFT corner tab, flush on the card's own edge,
            plus the rail stripe down the left side (owner, via pop-up
            question, 2026-08-30: "category top left ... add the category
            stripe back to the left side").
            data-frame-chrome: these elements deliberately bleed into the
            dialog's padding gutter (the rail is absolute left-0 relative to
            the fixed DialogContent; the badge row is in flow with negative
            margins — neither sits inside the p-4/p-5 content box) to achieve
            the flush-edge design — the apply-dialog-fit e2e excludes them
            from its content-overflow check on that basis. */}
        {/* No category stripe down the left edge and no corner tab (spec v2
            rebuild, audit 2026-10-21: no per-category colours; the category is
            an olive caption, like the job card's). */}
        {/* THE BADGE ROW IS IN FLOW, NOT ABSOLUTE, AND RESERVES THE ICON LANE.
            (owner, 2026-08-31, screenshot annotated "Covering buttons".)
            It used to be `absolute top-0 left-0 … flex items-stretch` — a
            shrink-to-fit strip with no width limit, sharing the sheet's top
            band with the OTHER absolutely-positioned cluster up there (the
            Share/Save/Report row at right-[46px] and the close X at right-3,
            both y=8..40). Two absolute siblings in one band collide as soon as
            the left one gets long, and the strip is z-20 against their z-10, so
            the pills painted OVER the buttons: measured before the fix, on a
            painting job that was recommended + urgent + boosted, the strip ran
            451px wide inside a 320/375px sheet and `elementFromPoint` at the
            centre of Share, Save and Report returned a BADGE, not the button —
            at 320, at 375 AND at 768 (where the sheet is 512px and the strip
            still overshoots the lane). Even a plain 2-badge job broke Share and
            Save at 320. It was never "three pills are one too many"; it was
            chrome positioned by hope.
            The fix has three parts and needs all of them:
              · RESERVE — `iconLaneReservePx` above is the icon cluster's real
                width, computed from dialog.tsx's own offsets and the 44px icon
                box, under the same conditions that decide which icons
                `cornerActions` renders — so the badges cannot enter the lane no
                matter how many of either render, and the number cannot fall
                behind a change to the icons' size (which is exactly what it did
                between 2026-09-11 and 2026-09-19).
              · POINTER-EVENTS-NONE — the reserve keeps the PILLS out of the
                lane, but this row is a stretched grid item, so its (empty,
                transparent) box still spans the full sheet width at z-20 and
                would sit on top of the buttons for hit-testing:
                `elementFromPoint` at each icon centre returned this DIV even
                where no pill was anywhere near it. The row holds nothing
                interactive, so it opts out of hit-testing entirely and taps
                land on the buttons underneath.
              · IN FLOW — `flex-wrap` + negative margins that cancel the
                dialog's own padding. Wrapping is only safe once the row takes
                a track: as an absolute box a second line would have landed on
                top of the title. In flow it pushes the title down instead, so
                0/1/2/3/4 badges are all just "the row is taller", and the
                title's clearance stops being the hand-tuned `mt-5` magic
                number it used to be (see the title row below).
            DELIBERATE TRADE-OFF: at 320px, four badges (~460px of pills) into
            a 168px lane-free width is genuinely 3–4 short lines. That is the
            chosen resolution — every badge stays readable and nothing hides —
            rather than truncating, clipping, or dropping the lower-priority
            pills, which would silently lose information the owner explicitly
            asked to carry over from the feed card. It only bites on the rare
            recommended+urgent+boosted job on the narrowest phone; 1–2 badges,
            the normal case, still render as one flush corner tab exactly as
            before. This is a change at EVERY width, not a phone-only one,
            because the collision was measured at 768 too. */}
        <div
          data-frame-chrome="true"
          className="relative order-first z-20 pointer-events-none flex flex-wrap items-center gap-2 min-w-0 min-h-[32px]"
          // Inline, not a `pr-*` class: the lane is a px geometry that does not
          // change with the breakpoint, and it is computed above rather than
          // looked up in a table that can fall behind the icons' real size.
          style={{ paddingRight: `${iconLaneReservePx}px` }}
        >
          <span
            className="inline-flex min-w-0 shrink items-center gap-1.5 text-ds-12 font-semibold leading-none"
            style={{ color: "hsl(var(--bark))" }}
          >
            <CategoryIcon
              category={job.category}
              aria-hidden
              className="w-3.5 h-3.5 shrink-0"
            />
            {/* Below 400px the rail is ~173px after the icon lane's reserve,
                and "Moving" + URGENT is 200 — so the category shrank to "M…"
                on every urgent/boosted/recommended sheet at 375 (measured
                2026-09-07 as Hallie on Perry's truck job). A one-letter label
                is worse than none: the glyph is unique per category and the
                title above says what the work is, so on a crowded rail the
                word steps aside and the icon carries it. Uncrowded rails and
                wider phones keep the word. */}
            <span
              className={`font-sans truncate ${railIsCrowded ? "max-[399px]:sr-only" : ""}`}
            >
              {categoryLabels[job.category] || formatCategory(job.category)}
            </span>
          </span>
          {/* Recommended — right of category, before Urgent/Boosted (owner:
              "if a job is recommended it should carry over on the right of
              the category before urgent/boosted"). Same tab styling as
              JobCard's own Recommended chip. */}
          {isRecommended && (
            <span
              // Olive outline chip, in the row (not rust, not poking over the
              // card's edge): it is a hint, not money.
              className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-ds-12 font-semibold leading-none"
              style={{ color: "hsl(var(--sage-ink))", borderColor: "hsl(var(--bark) / 0.45)" }}
            >
              <Star className="w-3.5 h-3.5 shrink-0" />
              Recommended
            </span>
          )}
          {/* Urgent/Boosted — right of category, same top-left cluster
              (owner: "move to right of category"). */}
          {job.is_urgent && (
            <span role="img"
              aria-label="Urgent"
              className="urgent-pulse inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-ds-12 font-semibold leading-none"
              style={{
                color: "hsl(var(--accent))",
                background: "hsl(var(--accent) / 0.15)",
                borderColor: "hsl(var(--accent) / 0.5)",
              }}
            >
              <Zap className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--accent))", fill: "hsl(var(--accent))" }} />
              Urgent
            </span>
          )}
          {job.isBoosted && (
            <span role="img"
              aria-label="Boosted"
              className="boosted-pulse inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-ds-12 font-semibold leading-none"
              style={{
                color: "hsl(var(--boost-ink))",
                background: "hsl(var(--boost-tint) / 0.16)",
                borderColor: "hsl(var(--boost-tint) / 0.5)",
              }}
            >
              <Rocket className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--boost-tint))", fill: "hsl(var(--boost-tint) / 0.35)" }} />
              Boosted
            </span>
          )}
        </div>
    </>
  );
}
