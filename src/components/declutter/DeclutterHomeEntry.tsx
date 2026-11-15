/**
 * /declutter's home, as DeclutterPage draws it: a member's tabs (DeclutterHomeView), or a guest's Browse.
 *
 * Q2705 (guest /declutter LCP over 2.5 s, 2026-11-14): DeclutterPage imported DeclutterHomeView statically, so a
 * guest's first round carried every member screen in it (the What next and still-available sheets, the confirm sheet,
 * My listings, the top bar's bell and their dialog code) beside the HTML-drawn first photos, the LCP. A guest now
 * draws DeclutterGuestHome from here and never loads DeclutterHomeView; a member's copy loads through loadModule, and
 * src/boot/declutterRoute.ts starts it beside the page for a visitor with a session, so a member waits no extra round.
 * Guard: src/boot/declutterGuestSkipsMemberCode.test.ts.
 */
import { lazy, Suspense } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { loadModule, untilReload } from "@/lib/loadModule";
import { DeclutterGuestHome } from "./DeclutterGuestHome";
import { DeclutterHomeSkeleton } from "./DeclutterSkeletons";

const DeclutterMemberHome = lazy(() => loadModule(() => import("./DeclutterHomeView")).then((m) => (m ? { default: m.default } : untilReload())));

export default function DeclutterHome() {
  const { user, isLoading } = useCurrentUser();
  if (user) return <Suspense fallback={<DeclutterHomeSkeleton />}><DeclutterMemberHome /></Suspense>;
  if (isLoading) return <DeclutterHomeSkeleton />;
  return <DeclutterGuestHome />;
}
