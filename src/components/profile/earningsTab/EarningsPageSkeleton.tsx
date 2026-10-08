import type { CSSProperties } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { TAB_TITLES } from "@/pages/profile/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * ONE skeleton for the Money tab (VN-3, owner 2026-09-15: "One skeleton.
 * Better organization").
 *
 * The page used to paint three different shapes on a cold load: the Profile
 * LANDING skeleton (avatar + three tiles) from the route and Profile's own
 * loading branch, then the real header, then each card popping in as its own
 * query landed. Measured on prod with helper-e2e: 6 layout shifts, CLS 0.243 at
 * 1440 and 0.480 at 375.
 *
 * This is the Earned half's silhouette (Q1177) — title row, the connect card,
 * the wallet, the Earned | Spent switcher, the Earned summary card — so every
 * loading frame has the layout the loaded page will have. `withHeader` is false where the real ProfileTabHeader and switcher are
 * already on screen.
 */
export function EarningsPageSkeleton({ withHeader = true }: { withHeader?: boolean }) {
  // DATA-AWARE (owner, 2026-10-03). The full-page skeleton is the route's,
  // Profile's and the tab chunk's placeholder, often drawn before the profile
  // has loaded. A profile with a Stripe account gets no connect card, so none
  // is drawn and the wallet card (the one page's first card) holds the slot
  // instead; with none, or not loaded yet (the typical case before launch),
  // the connect card IS coming and holds its slot at the top. The in-tab data
  // wait (`withHeader={false}`) draws the connect block in its own slot.
  const { profile } = useCurrentUser();
  const payoutSetup = withHeader && !profile?.stripe_account_id;
  const wallet = !!profile?.stripe_account_id;
  return (
    <ProfileTabBody aria-hidden data-testid="earnings-page-skeleton">
      {withHeader && (
        <>
          {/* The REAL header (68px), not a 44px bone row: the bone read 44
              against 68 loaded, a +20px jump on prod at 375 (2026-10-01). */}
          <ProfileTabHeader title={TAB_TITLES.earnings} />
        </>
      )}
      {payoutSetup && <EarningsPayoutSetupSkeleton />}
      {/* The Earned | Spent switcher's slot (its measured 50px). The in-tab
          wait draws the REAL switcher, which needs no data. */}
      {/* The wallet sits ABOVE the switcher (owner, 2026-10-08). The in-tab
          wait leaves its slot to EarningsTab, which draws it there. */}
      {withHeader && wallet && <EarningsWalletBones testId="earnings-wallet-skeleton" />}
      {withHeader && <Skeleton className="h-[50px] w-full rounded-full" />}
      <section className="space-y-3">
        <div className="rounded-2xl liquid-glass p-card space-y-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-5 w-24 rounded" />
          </div>
          <Skeleton className="h-11 w-full rounded-full" />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Skeleton className="h-8 w-32 rounded" />
              <Skeleton className="h-3 w-28 rounded" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-8 w-24 rounded" />
              <Skeleton className="h-3 w-20 rounded" />
            </div>
          </div>
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      </section>
    </ProfileTabBody>
  );
}

/**
 * Copy the page already KNOWS, laid out exactly where the real line will be and
 * painted as a bone: transparent text over the skeleton colour, one bar per
 * wrapped line. Each bar therefore takes the real line's width and height at
 * every viewport, which no fixed-height bone can. Only for fixed strings the
 * real component prints; never for data. The strings are pinned to their real
 * components by src/test/earningsPayoutSetupSkeleton.test.ts.
 */
function GhostLine({ className, style, children }: { className?: string; style?: CSSProperties; children: string }) {
  return (
    <p className={className} style={style}>
      <span
        className="text-transparent select-none rounded [box-decoration-break:clone] [-webkit-box-decoration-break:clone]"
        style={{ background: "hsl(var(--olivewood) / 0.10)" }}
      >
        {children}
      </span>
    </p>
  );
}

/**
 * DATA-AWARE (owner, 2026-10-03: "data-aware skeletons", the state known
 * before the data). For a Helpr with no payout account, PaymentTab draws
 * PayoutSetupForm's "Connect to start earning" card at the TOP of the page once
 * Stripe answers. A skeleton that never drew it made the page jump down by it
 * (+403px at 375 with the old activity card, loading-states run 2026-10-02 on
 * both test accounts). The profile row already says whether a Stripe account
 * exists, so EarningsTab draws this block, in the connect card's own slot,
 * exactly when the real one is coming. Same structure and classes as the real
 * card (PayoutSetupForm.tsx), so the heights agree at every width.
 *
 * NOT DRAWN: PaymentTab's Spent card, which follows the connect card only when
 * the reader has spent or earned something (Q1177; the old "No activity yet"
 * card is gone). Whether it comes is known only from the data, so its bone
 * would be wrong for every account that has no activity.
 */
/** WalletCard's shape (Available + Pending side by side, the action row). A
 *  connected Helpr's Earned half opens on it; it also holds the wallet's own
 *  slot while Stripe answers (the page itself never waits for Stripe). */
export function EarningsWalletBones({ testId = "earnings-wallet-loading" }: { testId?: string }) {
  return (
    <div data-testid={testId} className="rounded-2xl liquid-glass p-card space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20 rounded" />
          <Skeleton className="h-7 w-24 rounded" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-20 rounded" />
          <Skeleton className="h-7 w-24 rounded" />
        </div>
      </div>
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  );
}

export function EarningsPayoutSetupSkeleton() {
  return (
    <div aria-hidden data-testid="earnings-payout-setup-skeleton" className="space-y-section">
      <section className="space-y-2">
        <div className="rounded-2xl liquid-glass p-card">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Skeleton className="w-5 h-5 shrink-0 mt-0.5 rounded-full" />
              <div>
                <GhostLine className="font-display italic font-bold leading-tight text-ds-16" style={{ letterSpacing: "-0.015em" }}>
                  Connect to start earning
                </GhostLine>
                <GhostLine className="font-sans mt-1 text-ds-13">
                  Set up your payout account through Stripe so completed jobs pay out straight to your bank.
                </GhostLine>
              </div>
            </div>
            <Skeleton className="h-14 w-full rounded-ds-md" />
          </div>
        </div>
      </section>
    </div>
  );
}

/** True when the current URL opens the Earnings tab, so the route-level and
 *  Profile loading skeletons can paint the Earnings silhouette instead of the
 *  Profile landing's. */
export function isEarningsTabUrl(): boolean {
  if (typeof window === "undefined") return false;
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "earnings" || tab === "payment";
}
