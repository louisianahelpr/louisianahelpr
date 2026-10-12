import PageHeader from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsGroup } from "@/components/profile/profileLanding/SettingsSection";
import { WORK_MENU_GROUP } from "@/components/profile/profileLanding/workMenuGroup";

/**
 * The landing's identity card, as bones: IdentityHeader's own box
 * (`liquid-glass p-card`), its 88px ROUND avatar beside the name/location/bio
 * column, and the `mt-3.5 grid grid-cols-4 gap-2` row of 64px tiles (Share,
 * rating, Edit, Preview) INSIDE the card.
 *
 * It used to be a 75px rounded-square avatar in a `p-4` card with no tiles,
 * followed by a separate 3-up grid of 78px menu tiles the landing no longer
 * has. Measured on prod 2026-10-01 at 375 (customer and helper /profile #0):
 * the column's middle row went 80px → 201px (+121), 3 rows → 4, and the round
 * avatar arrived out of nothing (media 0 → 1).
 */
const IdentityCardSkeleton = () => (
  <div className="relative liquid-glass shrink-0 p-card overflow-hidden">
    <div className="flex flex-row items-center gap-4">
      <Skeleton className="w-[88px] h-[88px] rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-3 w-1/2 rounded-md" />
        <Skeleton className="h-3 w-full rounded-md" />
        <Skeleton className="h-3 w-3/4 rounded-md" />
        <Skeleton className="h-4 w-20 rounded-md" />
      </div>
    </div>
    <div className="mt-3.5 grid grid-cols-4 gap-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="min-h-[64px] rounded-ds-md" />
      ))}
    </div>
  </div>
);

/**
 * Full Profile-landing skeleton: the landing's column, child for child.
 *
 * ProfileLanding renders into Profile.tsx's `flex flex-col gap-3 lg:gap-4`
 * column: title, identity card, the "Finish setting up" row, the settings
 * list. This draws the same four children with the same gap, so each slot
 * holds the space its content lands in.
 *
 * DATA-AWARE (Q1173, the owner's Q722 rule): what is known before any data is
 * drawn for real. The title is the landing's own PageHeader ("Profile")
 * with ProfileLanding's exact props, and the first settings group is the real
 * Work group (WORK_MENU_GROUP, which no profile field changes) through the
 * same SettingsGroup markup, its rows inert until the page arrives. Only the
 * identity card, which is all profile data, stays as bones. Measured
 * 2026-10-03 (Q1158 lab, 375 Slow 4G + 4x CPU): the bones-only first frame was
 * on screen at 4.16 s but FCP waited for the profile card at 4.96 s.
 *
 * The setup row is CONDITIONAL in the real landing (it disappears once payout
 * is done); its bone is always drawn, because whether it shows is not known
 * until the Stripe status loads, and the state every new member starts in is
 * "something left to set up". A finished account sees the list rise 64px on
 * load.
 */
export const ProfilePageSkeleton = () => (
  <div className="flex flex-col gap-3 lg:gap-4" data-testid="profile-landing-skeleton">
    {/* ProfileLanding's title block, prop for prop (hideBack, width="none",
        topInsetHandled) and with the same `-mb-3 lg:-mb-4` that cancels the
        column gap under it, so the title does not move when the page lands. */}
    <div className="-mb-3 lg:-mb-4">
      <PageHeader
        title="Profile"
        hideBack
        width="none"
        topInsetHandled
      />
    </div>
    <IdentityCardSkeleton />
    <Skeleton className="h-[52px] rounded-ds-md" />
    {/* SettingsSection's own `space-y-4` list wrapper, holding its first
        group. aria-hidden: the loaded list is what a screen reader reads. */}
    <div className="space-y-4" aria-hidden>
      <SettingsGroup group={WORK_MENU_GROUP} />
    </div>
  </div>
);
