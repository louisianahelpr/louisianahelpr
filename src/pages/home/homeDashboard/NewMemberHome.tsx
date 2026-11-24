/**
 * A NEW MEMBER'S HOME (owner 11-14). Measured on prod over 14 days: of 37 new members, 18 saw /home once and left,
 * 5 opened Jobs (all 5 applied), 2 opened Declutter, none posted a job. So a member with nothing yet (HomeDashboard's
 * `welcome`: no job history, no Declutter use, nothing to do) gets, in order:
 *   1. the Get started guide, worded from their old start picks when they made any (GetStartedGuide): its rows are
 *      the starting actions (apply, list an item, post a job);
 *   2. "Jobs near you": real open jobs, nearest first, each opening its job page to apply (FirstJobHome's read);
 *   3. "For sale near you": real Declutter listings in a sideways row (ForSaleNearYou, loaded on its own).
 * An empty strip is simply not drawn. The welcome card that led it was removed by the owner
 * (2026-11-24, "remove both", with the full-screen first run of the same name).
 * Guard: src/test/newMemberHome1114.test.tsx.
 */
import { lazy, Suspense, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { JobsNearYouList, useJobsNearYou } from "./FirstJobHome";
import "@/lib/i18n/enHome";
import "@/lib/i18n/enNewMember";
import { useLanguage } from "@/lib/i18n/language";

// The guide rides this chunk too: HomeDashboard loads both with one request, off Home's first load.
export { GetStartedGuide } from "./GetStartedGuide";

// Its own chunk: the listings' photo and price modules never ride Home's first load (/home's critical-path budget).
const ForSaleNearYou = lazy(() => import("./ForSaleNearYou"));

/**
 * HOME'S QUIET DAY (owner 2026-11-17, signed-in tweaks item 4): nothing needs you and nothing is booked, so more than
 * half of Home was blank. Under Coming up: up to 3 open jobs near you and up to 4 new Declutter items, from the SAME
 * reads and rows as the new-member block above (useJobsNearYou + JobsNearYouList, ForSaleNearYou), in this chunk,
 * asked only after the page has settled (HomeDashboard). An empty strip is not drawn.
 */
export function NearYouBlock({ userId, sell }: { userId: string | undefined; sell: boolean }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const near = useJobsNearYou();
  return (
    <div data-testid="home-near-you" className="flex flex-col gap-section">
      <JobsNearYouList
        jobs={near.data ?? []}
        seeAll={
          <Button type="button" variant="link" size="sm" onClick={() => navigate("/jobs")} className="px-1 -my-2 text-ds-13 font-bold text-primary">
            {t("home.ns.seeAll")}
          </Button>
        }
      />
      {sell && <Suspense fallback={null}><ForSaleNearYou userId={userId} max={4} /></Suspense>}
    </div>
  );
}

export function NewMemberHome({ userId, sell, guide }: { userId: string | undefined; sell: boolean; guide: ReactNode }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const near = useJobsNearYou();
  return (
    <div data-testid="new-member-home" className="flex flex-col gap-section">
      {guide}
      <JobsNearYouList
        jobs={near.data ?? []}
        seeAll={
          <Button type="button" variant="link" size="sm" onClick={() => navigate("/jobs")} className="px-1 -my-2 text-ds-13 font-bold text-primary">
            {t("home.ns.seeAll")}
          </Button>
        }
      />
      {sell && <Suspense fallback={null}><ForSaleNearYou userId={userId} /></Suspense>}
    </div>
  );
}
