import PageHeader from "@/components/PageHeader";
import { ProfileHeroSkeleton } from "./ProfileHeroSkeleton";
import { ProReturnBanner } from "./ProReturnBanner";

/**
 * Q1695 (loading-states-refresh 42123572431, customer /user/<id> 487px blank -> 812px): while /user/<id> works out
 * where a MEMBER goes (PublicProfileForward's handle read, MemberForward's block check), the route drew the plain
 * RouteSuspenseFallback, so the page was blank and then the profile arrived. This is UserProfile's own loading frame
 * (its page wrapper, its "Profile" header with the Save + overflow bones, the same body), so a member who stays on
 * /user keeps the frame they see first. `own`: the member's own /user page (its title, no action bones).
 */
export function UserProfileForwardWait({ own }: { own: boolean }) {
  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav" data-testid="user-profile-forward-wait">
      <PageHeader
        title={own ? "How others see you" : "Profile"}
        titleActions={own ? null : (
          <div className="flex items-center gap-1" aria-hidden>
            <div className="h-10 w-10 rounded-ds-md bg-muted motion-safe:animate-pulse" />
            <div className="h-10 w-10 rounded-ds-md bg-muted motion-safe:animate-pulse" />
          </div>
        )}
      />
      <UserProfileLoadingBody proReturn={null} />
    </div>
  );
}

/**
 * Q806: UserProfile's loading body (under the page header), moved verbatim out of UserProfile.tsx (pure move).
 */
export function UserProfileLoadingBody({ proReturn }: { proReturn: "success" | "cancel" | null }) {
  return (
        <div className="page-measure mx-auto px-5 lg:px-6 xl:px-6 pb-8">
          {/* The SAME wrapper the loaded body uses below — full page measure,
              one column, gap-section (Q191; this said gap-6 while the loaded body
              below used gap-5, so the swap moved every card). It used to carry `max-w-2xl mx-auto`, a cap no
              other state on this page has: 86545cb12 moved all four states onto
              the shared shell and dropped that cap from the error and not-found
              branches, but missed this one. Measured at 1440: the skeleton
              column sat at 672px and the loaded column at 1096px, so the page
              visibly grew 1.63x the instant the query resolved — the owner's
              "opens small then gets bigger".

              The bones below also mirror the real card SHAPES rather than
              approximating them, because width was only half of it: two bones
              (~300px) were standing in for a body that runs 600–1500px, so the
              page grew vertically too, on every viewport including phone where
              the width cap never binds. */}
          <div className="flex flex-col gap-section items-stretch">
            <ProReturnBanner result={proReturn} />
            <ProfileHeroSkeleton />
            {/* NO bone below the card any more. It held space for
                "endorsements, availability and portfolio", but endorsements
                (migration 20260904034410) and the public availability section
                (VN-12) are gone; what can still render there is work photos
                and the Pro+ portfolio, which most profiles do not have. So a
                160px card sat where, for most members, nothing arrives, and
                the page shrank when the data landed. Those that have photos
                grow below the fold instead. */}
          </div>
        </div>
  );
}
