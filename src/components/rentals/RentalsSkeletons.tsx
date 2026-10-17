/**
 * What each Rentals screen looks like while the hidden 'rentals' switch (and
 * then the screen's own data) loads.
 *
 * RentalsGate used to render NOTHING while the switch loaded, so the first
 * frame was a blank page: measured 2026-10-15 (scripts/audit/measure-loading-states.mjs,
 * local build of ready/rentals-s1, prod backend, both test accounts) every
 * /rentals route settled on a blank frame with no placeholder for 2 waves of
 * data (9 surfaces, 0 measured). The Declutter gate had the same blank frame.
 *
 * THE GATE'S FRAME IS THE HEADER ONLY (RentalsGateFrame). Unlike Declutter
 * (on for testers when its gate got bones), the gate cannot know whether the
 * page will exist: while 'rentals' is off the switch's answer is the 404 for
 * every account. Bones of the two cards were measured against that 404 the
 * same day: -112px and 2 -> 3 rows on /rentals for both test accounts. So the
 * gate holds the real title in its final place and says it is loading, and
 * only the page's OWN loading state (switch on, data on its way) draws bones,
 * because there the cards always render.
 *
 * Each frame wears the screen's real shell, AppPage, with the screen's real
 * title (the ProfileTabFallback rule: the header is real, so nothing moves when
 * the page replaces it).
 */
import AppPage from "@/components/AppPage";
import { Skeleton } from "@/components/ui/skeleton";
import { RentalsCard } from "./rentalsUi";

/** /rentals while its data loads (switch on): the two cards with their real titles; one bone where each card's first line lands. */
export function RentalsHomeSkeleton() {
  return (
    <AppPage title="Rentals">
      <div className="space-y-4" role="status" aria-label="Loading your rentals">
        <RentalsCard title="Homes you rent">
          <Skeleton className="h-10 w-full rounded-xl" aria-hidden />
        </RentalsCard>
        <RentalsCard title="Properties you own">
          <Skeleton className="h-10 w-full rounded-xl" aria-hidden />
        </RentalsCard>
      </div>
    </AppPage>
  );
}

/**
 * The gate's frame while the switch's answer loads: the screen's real header
 * and NO bones (see the note at the top). The invite page uses it for its own
 * frame too: the invite card is static, so a bone would only guess at it.
 */
export function RentalsGateFrame({ title, backTo, label }: { title: string; backTo?: string; label: string }) {
  return (
    <AppPage title={title} backTo={backTo}>
      <p role="status" className="sr-only">
        {label}
      </p>
    </AppPage>
  );
}

/** /rentals/requests/:id while the request loads (switch on): the request card. */
export function MaintenanceRequestSkeleton() {
  return (
    <AppPage title="Repair request" backTo="/rentals">
      <div role="status" aria-label="Loading the request">
        <Skeleton className="h-64 w-full rounded-2xl" aria-hidden />
      </div>
    </AppPage>
  );
}

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a /rentals/requests/:id link can name a request at all (request ids are uuids). */
export function isRequestId(id: string | undefined): id is string {
  return !!id && REQUEST_ID.test(id);
}

/**
 * The request page for a request that is not there, or a link that never
 * named one. Also the gate's frame for a malformed link, where we know before
 * loading anything that no request will arrive (and the database would only
 * answer a malformed id with an error, never "not found").
 */
export function MaintenanceRequestUnavailable() {
  return (
    <AppPage title="Repair request" backTo="/rentals">
      <p className="text-sm">This request isn't available.</p>
    </AppPage>
  );
}
