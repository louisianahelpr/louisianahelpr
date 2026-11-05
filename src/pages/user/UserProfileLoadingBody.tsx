import { ProfileHeroSkeleton } from "./ProfileHeroSkeleton";
import { ProReturnBanner } from "./ProReturnBanner";

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
