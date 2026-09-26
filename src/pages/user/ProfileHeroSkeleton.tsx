import {
  PROFILE_HERO_AVATAR,
  PROFILE_HERO_CARD,
  PROFILE_HERO_PAD,
  PROFILE_HERO_RECORD,
  PROFILE_HERO_ROW,
} from "./ProfileHeaderCard";
import { AT_A_GLANCE_GRID, METRIC_CELL_FRAME } from "./AtAGlanceCard";

/**
 * The /user/:id masthead while the profile loads: ProfileHeaderCard's hero
 * (identity + earned badges) over AtAGlanceCard's record strip, drawn with
 * THEIR exported frames so the reservation is the real card's by construction.
 * Its own file so it can be rendered and checked without the page's queries
 * (ProfileHeroSkeleton.test.tsx).
 */
export function ProfileHeroSkeleton() {
  return (
    <>
    {/* The hero card's frame is IMPORTED from ProfileHeaderCard, not
        restated. These bones used to carry their own copy of it under
        a comment claiming they mirrored that card — and the copy had
        drifted: `flex flex-col sm:flex-row` here (a centred stack at
        375, with a 96px avatar) against `flex flex-row` and an 80px
        avatar there, at every width. Measured at 375 the whole
        identity block relaid out on arrival and the card went 326px
        to 309px. Same fix JobCardSkeleton got from cardGeometry:
        share the declaration so neither side can move alone. */}
    <div className={PROFILE_HERO_CARD}>
      <div className={PROFILE_HERO_PAD}>
        <div className={PROFILE_HERO_ROW}>
          <div className={`${PROFILE_HERO_AVATAR} shrink-0 bg-muted motion-safe:animate-pulse`} />
          {/* The identity column, LINE BOX BY LINE BOX, each bone
              centred in the height the real line takes (ds-22 at
              1.25, ds-13 at 1.45, ds-15 at 1.5, the margins
              ProfileHeaderCard puts between them): the name, then
              place / "Since …" / last active — stacked below `sm`
              and one row from `sm`, exactly as that card lays them
              out — then two lines of bio (capped at the bio's own 62ch measure). It was three bars in a
              72px column standing in for a 147–183px one, so the
              record strip below it opened ~130px too high and was
              pushed down when the profile landed (loading-states-
              refresh 36158775025: row 64 -> 183, 4 rows -> 2). What
              a member has actually written is unknowable here; this
              reserves the complete-profile shape, and a longer bio
              or a second badge row grows the card below it. */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center h-[27.5px] mb-1">
              <div className="h-6 w-40 max-w-full bg-muted motion-safe:animate-pulse rounded" />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1.5 mb-1.5">
              {["w-24", "w-28", "w-20"].map((w) => (
                <div key={w} className="flex items-center h-[19px]">
                  <div className={`h-3.5 ${w} max-w-full bg-muted motion-safe:animate-pulse rounded`} />
                </div>
              ))}
            </div>
            <div className="mt-2.5 max-w-[62ch]">
              {["w-full", "w-2/3"].map((w) => (
                <div key={w} className="flex items-center h-[22.5px]">
                  <div className={`h-4 ${w} bg-muted motion-safe:animate-pulse rounded`} />
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* EARNED — RecognitionRow's one group: its caption line
            (ds-10 at 1.45, `mb-1`) over one row of badge pills, in
            the `mt-4` slot ProfileHeaderCard gives it. */}
        <div className="mt-4">
          <div className="flex items-center h-[14.5px] mb-1">
            <div className="h-2.5 w-16 bg-muted motion-safe:animate-pulse rounded" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {["w-20", "w-24", "w-16"].map((w) => (
              <div key={w} className={`h-6 ${w} rounded-ds-pill bg-muted motion-safe:animate-pulse`} />
            ))}
          </div>
        </div>
      </div>
      {/* THE RECORD strip, inside the same card and behind the same
          hairline the card draws it behind — a 2x2 stat grid. It used
          to be a 3-up row of separate cards BELOW the hero, standing
          in for something this page does not have: the stats live
          inside the masthead. */}
      <div
        className={PROFILE_HERO_RECORD}
        style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.14)" }}
      >
        {/* AtAGlanceCard's own grid and tile frame, imported: 58px
            tiles two-up at 375 and one row of four from `sm`. These
            were `p-3` boxes (64px) in a plain `grid-cols-2`, i.e. a
            2x2 block at 1440 where the real strip is 1x4. Inside,
            the value line (ds-18, leading-none) and the label line
            (ds-11, leading-snug) at their real heights. */}
        <div className={AT_A_GLANCE_GRID}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={METRIC_CELL_FRAME} style={{ background: "hsl(var(--olivewood) / 0.05)" }}>
              <div className="h-[18px] w-12 bg-muted motion-safe:animate-pulse rounded" />
              <div className="flex items-center h-[15px]">
                <div className="h-3 w-16 bg-muted motion-safe:animate-pulse rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
    </>
  );
}
