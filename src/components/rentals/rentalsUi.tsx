import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useFeature } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import { featureSwitchSettled } from "@/lib/featureSwitchQuery";
import { Link } from "react-router-dom";
import { KeyRound } from "lucide-react";
import NotFound from "@/pages/info/NotFound";
import { Button } from "@/components/ui/button";
import { BrowseEmptyState } from "@/components/ui/BrowseEmptyState";
import { SectionScreen } from "@/components/sections/SectionScreen";

/**
 * Every Rentals page renders the 404 (the section's own root /rentals: "Opens soon", below) unless the hidden 'rentals' switch is on
 * for the member (the DeclutterGate pattern). While the server's answer is
 * loading it renders the screen's own `skeleton` (RentalsSkeletons.tsx: the
 * page's real AppPage shell and title), never a
 * blank page and never a flash of the 404 for a tester. The server refuses
 * regardless (require_feature in every rentals_* RPC); this only keeps the
 * screens hidden.
 */
export function RentalsGate({ children, skeleton, sectionRoot = false }: { children: ReactNode; skeleton: ReactNode; sectionRoot?: boolean }) {
  const enabled = useFeature("rentals");
  const { user, isReady } = useAuthReady();
  const qc = useQueryClient();
  if (enabled) return <>{children}</>;
  const settled = isReady && (!user || featureSwitchSettled(qc, "rentals", user.id));
  if (!settled) return <>{skeleton}</>;
  return sectionRoot ? <HomesOpensSoon /> : <NotFound />;
}

/** The words a member sees on the Homes tab while Homes has not opened to them. */
export const HOMES_OPENS_SOON_BODY = "Homes opens here soon. Until then, hire help in Jobs or buy and sell in Declutter.";

/**
 * The phone dock lists Homes before it opens (owner, nav redesign 2026-11-06 11:35 AM: no "Soon" on the tab,
 * "the screen says it is coming"), so /rentals with the switch off is its section frame holding "Opens soon" in the
 * shared Browse empty state (the Shops Q2005 screen), never the bare 404. It says "Coming soon", the word the menu, the
 * Create sheet and Settings use (owner's UI audit 11-09, F139; it said "Opens soon").
 */
function HomesOpensSoon() {
  return (
    <SectionScreen section="homes" title="Homes" globalSearch={false} search={null}>
      <BrowseEmptyState
        icon={KeyRound}
        title="Coming soon"
        body={HOMES_OPENS_SOON_BODY}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/home">Go to Dashboard</Link>
          </Button>
        }
      />
    </SectionScreen>
  );
}

/**
 * One group on a Homes screen: a quiet uppercase header (the Shops/Jobs
 * section-dashboard header) OUTSIDE the card, then one flat card holding the
 * content. `bare` drops the card for a group whose items are cards themselves
 * (a property, a home you rent): owner bar 2026-10-19, never a card inside a
 * card.
 */
export function RentalsCard({ title, children, action, bare = false }: { title: string; children: ReactNode; action?: ReactNode; bare?: boolean }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div className="flex min-h-9 items-center justify-between gap-3 px-1">
        <h2 className="text-ds-13 font-bold uppercase tracking-[0.06em] text-muted-foreground">{title}</h2>
        {action}
      </div>
      {bare ? <div className="space-y-3">{children}</div> : <div className={`${RENTALS_ITEM_CARD} space-y-3`}>{children}</div>}
    </section>
  );
}

/** The one card surface for a thing on a Homes screen (flat: hairline, no shadow, no box inside it). */
export const RENTALS_ITEM_CARD = "rounded-2xl border border-border bg-card p-4";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

