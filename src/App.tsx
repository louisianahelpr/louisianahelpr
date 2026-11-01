import { lazy, Suspense, forwardRef, useState, type ComponentType, type ReactElement, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { useBugReportScreen } from "@/hooks/useBugReportScreen";
import { lazyWithPreload } from "@/lib/lazyWithPreload";
import { whenPageSettled } from "@/lib/routePrefetch";
import { SpeedInsightsRouted } from "@/components/SpeedInsightsRouted";
import { Analytics } from "@vercel/analytics/react";

import QueryCacheHydrator from "@/components/QueryCacheHydrator";
import DeferredToasters from "@/components/DeferredToasters";
// Shared singleton so the SIGNED_OUT handler in main.tsx can wipe the
// same cache the provider wraps. See src/lib/queryClient.ts.
import { queryClient } from "@/lib/queryClient";

import ErrorBoundary from "@/components/ErrorBoundary";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import RouteSuspenseFallback from "@/components/RouteSuspenseFallback";
// Per-route Suspense fallbacks, on demand (Q178): src/lib/skeletonOnDemand.tsx.
import { skeletonOnDemand } from "@/lib/skeletonOnDemand";
const GuestBrowseSkeleton = skeletonOnDemand(() => import("@/components/GuestBrowseSkeleton"));
const DashboardRouteSkeleton = skeletonOnDemand(() => import("@/components/DashboardRouteSkeleton"));
const JobsSectionSkeleton = skeletonOnDemand(() => import("@/components/JobsSectionSkeleton"));
const ProfileRouteSkeleton = skeletonOnDemand(() => import("@/components/ProfileRouteSkeleton"));
const LoginRouteSkeleton = skeletonOnDemand(() => import("@/components/LoginRouteSkeleton"));
// Static on purpose (Q1107): a lazy banner must be fetched to say the network
// is down. lucide and supabase are in main's graph anyway (2026-10-05 build).
// Guard: src/test/offlineSurfacesAreStatic.test.ts.
import OfflineBanner from "@/components/OfflineBanner";
import { OfflineBannerLayoutProvider } from "@/lib/offlineBannerLayout";
import NativeLaunchRouter from "@/components/NativeLaunchRouter";
import RouteMemory from "@/components/RouteMemory";
import StaleClientWatch from "@/components/StaleClientWatch";
// Tiny + Supabase-free by design (a synchronous localStorage probe plus a
// lazy boundary) so it can be imported eagerly here without putting the
// auth check — and therefore Supabase — on the landing page's LCP path.
import MarketingRedirect from "@/components/MarketingRedirect";
import { AppLockGate } from "@/components/AppLockGate";
import { ForceUpdateGate } from "@/components/ForceUpdateGate";
import { SessionManager } from "@/components/SessionManager";
import { SignedInChrome, SignedInOnly } from "@/components/SignedInChrome";
import { WebDesktopOnly } from "@/components/WebDesktopOnly";

// PageTransition (the iPhone edge swipe-back) and ScrollToTop no longer use
// framer-motion (Q1356; check-deferred-vendors.mjs holds them to it). Q178: a
// lazy wrapper suspends its CHILDREN until its chunk lands, so no route could
// REQUEST its page chunk before PageTransition arrived (Index at 3.9 s on a slow
// phone). So the wrapper never suspends: until the gesture component has
// loaded it renders a plain keyed <div> (a cold first page has no history to
// swipe back to). It loads once the page has settled. The pick is made once
// per navigation (keyed by location.key), so a page never swaps wrappers
// (which would remount it) mid-life.
let AnimatedPageTransition: ComponentType<{ children: ReactNode }> | null = null;
const loadAnimatedPageTransition = () =>
  import("@/components/PageTransition").then((m) => {
    AnimatedPageTransition = m.default;
  });
whenPageSettled(() => {
  // B53: index.html holds the landing hero's Bodoni preloads back off "/" (no other first screen draws Bodoni, and
  // they took Home's bandwidth); warm them now, so a later Bodoni heading finds them cached.
  document.querySelectorAll<HTMLLinkElement>("link[data-lh-hero-font]").forEach((link) => {
    link.media = "all";
  });
  void loadAnimatedPageTransition().catch(() => {
    /* the swipe-back is a convenience: without it pages still render, and the back button still works */
  });
});
const PageTransitionPick = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const [Animated] = useState(() => AnimatedPageTransition);
  if (!Animated) return <div key={location.key}>{children}</div>;
  return <Animated>{children}</Animated>;
};
// Keyed so each navigation re-picks: React reuses this across same-shaped
// routes, and a once-per-mount pick kept a cold start's plain div, without the
// swipe-back, for the whole session (/login -> /signup, 2026-10-12).
const PageTransition = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  return <PageTransitionPick key={location.key}>{children}</PageTransitionPick>;
};
const ScrollToTop = lazy(() => import("@/components/ScrollToTop"));
const MobileNav = lazy(() => import("./components/MobileNav"));
const DesktopSidebarNav = lazy(() => import("./components/DesktopSidebarNav"));
const DesktopTopNav = lazy(() => import("./components/DesktopTopNav"));
// Q2440: "Online for deliveries" chip above the dock while a Helpr is online (phone web and the app).
const DeliveryOnlinePill = lazy(() => import("./components/declutter/DeliveryOnlinePill").then((m) => ({ default: () => <m.DeliveryOnlinePill placement="dock" /> })));
// Badge = To-do (owner, 2026-10-20): publishes Home's to-do count for the navs.
const NeedsYouMount = lazy(() => import("./components/NeedsYouMount"));
import { SidePanelProvider } from "./components/sidePanelOpen";
// /quotes is retired (owner 2026-10-19): old hub links redirect to Posts, Jobs or My Jobs (src/lib/quotes/homes.ts).
// A thin host: the dialog's chunk loads on the first ask or once the page settles (B86).
const PermissionRationaleMount = lazy(() =>
  import("@/components/PermissionRationaleMount").then((m) => ({ default: m.PermissionRationaleMount }))
);
// Terms re-consent and the one Stripe Identity sheet (owner 2026-10-21): small
// always-mounted parts that fetch their dialog only when it has to show
// (src/components/TermsReconsentMount.tsx, identity/IdentityCheckMount.tsx).
const TermsReconsentMount = lazy(() => import("@/components/TermsReconsentMount").then((m) => ({ default: m.TermsReconsentMount })));
const IdentityCheckMount = lazy(() => import("@/components/identity/IdentityCheckMount").then((m) => ({ default: m.IdentityCheckMount })));

// Lazy load all pages including landing
const Index = lazyWithPreload(() => import("./pages/info/Index"));

// Lazy load all other pages
const Login = lazyWithPreload(() => import("./pages/auth/Login"));
const Signup = lazyWithPreload(() => import("./pages/auth/Signup"));
const SignupPending = lazyWithPreload(() => import("./pages/auth/SignupPending"));
const CompleteProfile = lazyWithPreload(() => import("./pages/auth/CompleteProfile"));
const AccountBanned = lazyWithPreload(() => import("./pages/auth/AccountBanned"));
const ForgotPassword = lazyWithPreload(() => import("./pages/auth/ForgotPassword"));
const ResetPassword = lazyWithPreload(() => import("./pages/auth/ResetPassword"));
const Unsubscribe = lazyWithPreload(() => import("./pages/auth/Unsubscribe"));
// HOME (owner final decisions, 2026-10-19): the app opens on the dashboard
// for every section; the job feed moved to Jobs > Browse.
const HomeDashboard = lazyWithPreload(() => import("./pages/home/HomeDashboard"));
const Profile = lazyWithPreload(() => import("./pages/profile/Profile"));
// Lazy: it reads useAuthReady, which pulls the Supabase client.
const PostJob = lazyWithPreload(() => import("./pages/post-job/PostJob"));
const PaymentSuccess = lazyWithPreload(() => import("./pages/post-job/PaymentSuccess"));
const UserProfile = lazyWithPreload(() => import("./pages/user/UserProfile"));
const Admin = lazyWithPreload(() => import("./pages/admin/Admin"));
const PostsPage = lazyWithPreload(() => import("./pages/posts/PostsPage"));
// A redirect (to the last or first open section): no screen of its own.
const ExploreRedirect = lazyWithPreload(() => import("./pages/explore/Explore"));
// Jobs & Posts (owner, 2026-10-19): Browse | Posted | Working; /posts redirects to ?tab=posted.
const JobsPage = lazyWithPreload(() => import("./pages/jobs/JobsSection"));
const SearchPage = lazyWithPreload(() => import("./pages/search/SearchPage"));
const FindHelprs = lazyWithPreload(() => import("./pages/helprs/FindHelprs"));
const Messages = lazyWithPreload(() => import("./pages/messages/Messages"));
// Declutter (docs/specs/declutter-*.md): each page is the 404 unless its hidden switch is on (DeclutterGate).
const DeclutterPage = lazyWithPreload(() => import("./pages/declutter/DeclutterPage"));
const DeclutterItemPage = lazyWithPreload(() => import("./pages/declutter/DeclutterItemPage"));
// BUY-16: guests read a shared listing; members go through ProtectedRoute as before.
const DeclutterGuestOrMember = lazy(() => import("./components/declutter/DeclutterGuestRoute"));
const DeclutterSellPage = lazyWithPreload(() => import("./pages/declutter/DeclutterSellPage"));
const DeclutterMovePage = lazyWithPreload(() => import("./pages/declutter/DeclutterMovePage"));
const DeclutterSettingsPage = lazyWithPreload(() => import("./pages/declutter/DeclutterSettingsPage"));
// Quotes on jobs (owner Q1-Q8): each page renders the 404 unless the hidden
// 'quotes' switch is on for the member (QuotesGate).
const QuoteRequestPage = lazyWithPreload(() => import("./pages/quotes/QuoteRequestPage"));
// Board 181: the Helpr's "X tipped you" moment (the tip notification opens it).
const TipMoment = lazyWithPreload(() => import("./pages/tips/TipMoment"));
// The retired /quotes hub: a route like every other, loaded on demand (it resolves a quote notice's side at open time).
const QuotesHubRedirect = lazyWithPreload(() => import("./components/quotes/QuotesHubRedirect"));
const SendQuotePage = lazyWithPreload(() => import("./pages/quotes/SendQuotePage"));
// Shops (docs/specs/local-shops-prep.md): each page renders the 404 unless the hidden 'shops' switch is on for the member (ShopsGate).
const ShopsPage = lazyWithPreload(() => import("./pages/shops/ShopsPage"));
const ShopPage = lazyWithPreload(() => import("./pages/shops/ShopPage"));
const BookHelprPage = lazyWithPreload(() => import("./pages/book/BookHelprPage"));
const PublicProfilePage = lazyWithPreload(() => import("./pages/u/PublicProfilePage"));
const ShopEditPage = lazyWithPreload(() => import("./pages/shops/ShopEditPage"));
// Rentals S1 (docs/specs/landlord-hub-prep.md): the 404 unless the hidden
// 'rentals' switch is on for the member (RentalsGate).
const RentalsPage = lazyWithPreload(() => import("./pages/rentals/RentalsPage"));
const RentalsInvitePage = lazyWithPreload(() => import("./pages/rentals/RentalsInvitePage"));
const MaintenanceRequestPage = lazyWithPreload(() => import("./pages/rentals/MaintenanceRequestPage"));
const ListingPage = lazyWithPreload(() => import("./pages/rentals/ListingPage"));
const ListingEditPage = lazyWithPreload(() => import("./pages/rentals/ListingEditPage"));
const ShopOrdersPage = lazyWithPreload(() => import("./pages/shops/ShopOrdersPage"));
const ShopDashboardPage = lazyWithPreload(() => import("./pages/shops/ShopDashboardPage"));

const Legal = lazyWithPreload(() => import("./pages/info/Legal"));
const NotFound = lazyWithPreload(() => import("./pages/info/NotFound"));
const JobDetail = lazyWithPreload(() => import("./pages/jobs/JobDetail"));
const JobsSettings = lazyWithPreload(() => import("./pages/jobs/JobsSettings"));
const DashboardGuest = lazyWithPreload(() => import("./pages/home/DashboardGuest"));

// The seven pages that used to be lazy-imported here are now Profile tabs and
// are lazy-imported by ProfileTabPanels instead: PetProfiles, WorkRecord,
// HomeHistory, HelprWrapped, StrSettings, HelperAnalytics, AutoTip.
const HelpCenter = lazyWithPreload(() => import("./pages/info/HelpCenter"));
const HireTownPage = lazyWithPreload(() => import("./pages/info/HireTownPage"));
const SmsOptIn = lazyWithPreload(() => import("./pages/info/SmsOptIn"));
const LegalFullText = lazyWithPreload(() => import("./pages/info/LegalFullText"));
const Support = lazyWithPreload(() => import("./pages/info/Support"));

// Lazy load less-critical global components


const StrikeBanner = lazy(() => import("./components/StrikeBanner"));

// Lazy load route wrappers
const ProtectedRoute = lazy(() => import("./components/ProtectedRoute"));
const AdminRoute = lazy(() => import("./components/AdminRoute"));

/**
 * Wraps a single route's lazy content in its own `<Suspense>` with a
 * branded parchment fallback so navigating between routes doesn't blank
 * the persistent shell (header, banners, mobile nav). Each route gets its
 * own independent Suspense boundary — the fallback renders in place of
 * THAT route only.
 *
 * Composes inside `RouteErrorBoundary` (`<RouteErrorBoundary>{routeEl(...)}
 * </RouteErrorBoundary>`) so a lazy-chunk fetch failure still surfaces
 * the branded route-error UI instead of suspending forever.
 */
/**
 * The landing page's load fallback: the plain page background and nothing
 * else (owner, 2026-09-23: no H loader and no dashboard-shaped skeleton
 * before the landing page; a guest saw the generic route skeleton, then the
 * landing page, which read as a jump). Same ground as the #boot-loader shell
 * in index.html, so boot -> chunk load -> landing paints as one surface.
 */
const LandingPlainFallback = () => <div className="min-h-screen bg-premium-page" aria-busy="true" />;

const routeEl = (node: ReactElement, fallback: ReactElement = <RouteSuspenseFallback />) => (
  <Suspense fallback={fallback}>{node}</Suspense>
);


const AnimatedRoutes = forwardRef<HTMLDivElement>((_props, _ref) => {
  const location = useLocation();
  return (
    <Routes location={location}>
      {/* SIGNED-IN VISITORS SKIP THE MARKETING SITE.
          Owner decision: once someone is signed in there should be no
          references back to landing — everything they need is in the app. So
          the landing route bounces an authenticated visitor to /home.

          <MarketingRedirect> wraps OUTSIDE routeEl() on purpose: it renders
          `children` only in the guest branch, so a signed-in visitor never
          starts the Index chunk download at all, and a guest's
          download starts on exactly the same tick as before.

          Every other public route is deliberately NOT wrapped — see the
          per-route notes below and the block comment in MarketingRedirect. */}
      {/* THE SAME FIX /browse GOT, on the route more people actually land on.
          MarketingRedirect's `fallback` defaults to a BLANK
          `min-h-screen bg-premium-page`, and this route never overrode it — so
          a token-holding visitor on `/` got, measured on prod at 1440 with the
          network throttled to ~1.2Mbps and CPU 4x:

            400ms   the inline FCP shell (brand mark)
            890ms   a loading surface carrying RouteSuspenseFallback's own
                    sr-only "Loading…"
            1403ms  Dashboard's OWN loading branch — "Loading jobs near you…",
                    a completely different shape
            2497ms  real content ("8 jobs")

          Three different-shaped surfaces before the page, which is the owner's
          report twice over: "the home dashboard webpage goes through like 3
          different loading screens then opens" (2026-09-19, fixed for
          /home by DashboardRouteSkeleton) and "the loading for the webpage
          should go straight to the webpage not load another thing then go to
          webpage" (2026-09-22).

          DashboardRouteSkeleton is the shape of where a signed-in visitor is
          GOING, so the redirect lands in a frame it keeps — the reasoning
          spelled out on /browse above, which fixed the identical hop. Guests
          are untouched: `hasPersistedAuthToken()` returns false for them and
          `children` renders on exactly the same tick as before. */}
      <Route path="/" element={<RouteErrorBoundary><MarketingRedirect fallback={<DashboardRouteSkeleton />}>{routeEl(<PageTransition><Index /></PageTransition>, <LandingPlainFallback />)}</MarketingRedirect></RouteErrorBoundary>} />
      <Route path="/login" element={<RouteErrorBoundary>{routeEl(<PageTransition><Login /></PageTransition>, <LoginRouteSkeleton />)}</RouteErrorBoundary>} />
      <Route path="/signup" element={<RouteErrorBoundary>{routeEl(<PageTransition><Signup /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/signup-pending" element={<RouteErrorBoundary>{routeEl(<PageTransition><SignupPending /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/complete-profile" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><CompleteProfile /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/account-banned" element={<RouteErrorBoundary>{routeEl(<PageTransition><AccountBanned /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/forgot-password" element={<RouteErrorBoundary>{routeEl(<PageTransition><ForgotPassword /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/reset-password" element={<RouteErrorBoundary>{routeEl(<PageTransition><ResetPassword /></PageTransition>)}</RouteErrorBoundary>} />
      {/* Q1655: public on purpose. An email's unsubscribe link lands here signed
          out; the signed link (e/sig/list) is the only credential. */}
      <Route path="/unsubscribe" element={<RouteErrorBoundary>{routeEl(<PageTransition><Unsubscribe /></PageTransition>)}</RouteErrorBoundary>} />
      {/* No approval review (Q193): every protected route is mounted the same
          way, with no per-route gate props (Q205a). Verification still gates
          the moments that require it (accept, payout) inside the components.
          Banned users are redirected, and an unverified EMAIL is redirected to
          /signup-pending on every protected route (Q180, Q193) — see ProtectedRoute. */}
      <Route path="/home" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute fallback={<DashboardRouteSkeleton />}><HomeDashboard /></ProtectedRoute>, <DashboardRouteSkeleton />)}</RouteErrorBoundary>} />
      <Route path="/profile" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute fallback={<ProfileRouteSkeleton />}><Profile /></ProtectedRoute>, <ProfileRouteSkeleton />)}</RouteErrorBoundary>} />
      <Route path="/post-job" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><PostJob /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/jobs" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute fallback={<JobsSectionSkeleton />}><JobsPage /></ProtectedRoute>, <JobsSectionSkeleton />)}</RouteErrorBoundary>} />
      <Route path="/explore" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><ExploreRedirect /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/posts" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute fallback={<JobsSectionSkeleton />}><PostsPage /></ProtectedRoute>, <JobsSectionSkeleton />)}</RouteErrorBoundary>} />
      <Route path="/payment-success" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><PaymentSuccess /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/user/:userId" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><UserProfile /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/admin" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><AdminRoute><Admin /></AdminRoute></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/messages" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><Messages /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/declutter" element={<RouteErrorBoundary>{routeEl(<DeclutterGuestOrMember><DeclutterPage /></DeclutterGuestOrMember>)}</RouteErrorBoundary>} />
      <Route path="/declutter/sell" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><DeclutterSellPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/declutter/move" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><DeclutterMovePage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/declutter/settings" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><DeclutterSettingsPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/declutter/item/:id" element={<RouteErrorBoundary>{routeEl(<DeclutterGuestOrMember><DeclutterItemPage /></DeclutterGuestOrMember>)}</RouteErrorBoundary>} />
      <Route path="/quotes" element={routeEl(<QuotesHubRedirect />)} />
      <Route path="/quotes/request/:id" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><QuoteRequestPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/tips/:tipId" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><TipMoment /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/quotes/send/:id" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><SendQuotePage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/shops" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><ShopsPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/shops/mine" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><ShopEditPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/shops/orders" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><ShopOrdersPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/shops/dashboard" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><ShopDashboardPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      {/* SH2b (owner 2026-10-19): a shop page is open to anyone with the link;
          ShopPage picks the full or the public view. noindex via api/share.ts. */}
      <Route path="/shops/:id" element={<RouteErrorBoundary>{routeEl(<ShopPage />)}</RouteErrorBoundary>} />
      {/* /book/:userId: a Helpr's "Book me" link, open to anyone (B59). Card via api/share.ts. */}
      <Route path="/book/:userId" element={<RouteErrorBoundary>{routeEl(<BookHelprPage />)}</RouteErrorBoundary>} />
      {/* /u/:handle: a member's shareable profile, open to anyone (LEAD-PROFILE-LINK). Card via api/share.ts. */}
      <Route path="/u/:handle" element={<RouteErrorBoundary>{routeEl(<PublicProfilePage />)}</RouteErrorBoundary>} />
      <Route path="/rentals" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><RentalsPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/rentals/invite/:token" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><RentalsInvitePage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/rentals/requests/:id" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><MaintenanceRequestPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/rentals/listings/new" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><ListingEditPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/rentals/listings/:id" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><ListingPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/rentals/listings/:id/edit" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><ListingEditPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      {/* /support is linked from PolicyFooter (the card that closes the legal
          policy tabs AND the Help Center), and the account-banned screen, so it must resolve WITHOUT auth — a suspended or
          not-yet-approved account has no other route to a human. NOT from
          <Footer>: the site footer carries no /support link.
          It used to redirect to /help — a
          static FAQ whose only contact affordance was a raw `mailto:` (which
          does nothing inside the native app). It now renders a real contact
          form that works signed-out AND signed-in (prefilled from the profile).
          Authed users still get the same form as a Profile tab.
          It IS wrapped in PageTransition, as /legal and /help are: see the
          note directly below (Q965 corrected this; it used to say it was not).

          NOT wrapped in <MarketingRedirect>, even though /profile?tab=support
          renders the same form from the same shared copy (lib/supportTopics.ts).
          Two reasons it must stay on its own route: AccountBanned links here
          for the suspension appeal, and /profile is behind ProtectedRoute whose
          ban check fires on every protected route — a banned user would be thrown
          back to /account-banned, losing the only appeal path. It also carries
          ?topic= / ?subject= prefill that the Profile tab does not read. */}
      <Route path="/support" element={<RouteErrorBoundary>{routeEl(<PageTransition><Support /></PageTransition>)}</RouteErrorBoundary>} />

      {/* PageTransition's animated motion.div sets `will-change:
          transform`, which makes it the containing block for a
          `position: fixed` descendant such as the marketing Navbar. This
          comment used to say /legal and /help skip PageTransition for
          that reason; they do not: /legal, /terms, /privacy, /rules,
          /help and /support are all wrapped (read the routes). Whether
          the marketing Navbar still stays fixed while those pages
          scroll on the web is a browser check, recorded under Q965. */}
      {/* NOT wrapped in <MarketingRedirect>, and must not be.
          These are the only place the policy TEXT exists. The in-app Legal tab
          (/profile?tab=legal) is NOT a second copy of it — read LegalTab.tsx:
          it is a directory whose rows link to /rules, /terms, /privacy and to
          /legal?tab=…#anchor. Bouncing a signed-in reader there would land
          them on a page whose own links point straight back here, and they
          would never actually reach Terms.
          Legally load-bearing too: these are what the signup consent
          checkboxes link to, so they stay reachable in every auth state.
          Chrome is already handled — Legal.tsx renders inside AppShell on
          native and PublicLayout on web. */}
      <Route path="/legal" element={<RouteErrorBoundary>{routeEl(<PageTransition><Legal /></PageTransition>)}</RouteErrorBoundary>} />
      {/* Real routes, not redirects (owner, 2026-09-11): these used to be
          <Navigate to="/legal?tab=…" replace/>, so a fresh tab (the signup
          consent checkboxes open target="_blank" to /terms) cold-booted the
          whole SPA, matched /terms, client-redirected to /legal, and only
          then lazy-loaded the Legal chunk — a full routing round-trip plus a
          re-render on the coldest possible path. Rendering <Legal/> directly
          here, wrapped identically to the /legal route above, removes the
          hop. Legal.tsx reads the tab from the PATH when there is no ?tab=
          (see PATH_TAB there). Every property from the comment above the
          /legal route still applies — not MarketingRedirect, reachable in
          every auth state — since this is the same element, just mounted at
          a different path. */}
      <Route path="/terms" element={<RouteErrorBoundary>{routeEl(<PageTransition><Legal /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/privacy" element={<RouteErrorBoundary>{routeEl(<PageTransition><Legal /></PageTransition>)}</RouteErrorBoundary>} />
      {/* The same Terms and Privacy Policy as one open document each, nothing to tap (owner 2026-10-23, Twilio's A2P
          review). Public in every auth state, like the two routes above. */}
      <Route path="/terms/full" element={<RouteErrorBoundary>{routeEl(<PageTransition><LegalFullText doc="terms" /></PageTransition>)}</RouteErrorBoundary>} />
      <Route path="/privacy/full" element={<RouteErrorBoundary>{routeEl(<PageTransition><LegalFullText doc="privacy" /></PageTransition>)}</RouteErrorBoundary>} />


      {/* A SHARED JOB LINK SHOWS THE JOB TO A GUEST (10-30 jobs audit, items 1 and 2).
          From 2026-09-02 this route was signed-in-only (owner's call then, to match
          the browse card), so someone tapping a job shared on Facebook met a login
          wall with no job, price or town. It now opens JobDetail's guest branch: the
          public masked view only, no poster, and every action goes to sign-up with
          the job carried. Signed-in visitors still pass every ProtectedRoute gate. */}
      {/* Jobs settings (lead decision 2026-10-19, option A): a static segment, so it ranks above /jobs/:id. */}
      <Route path="/search" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><SearchPage /></ProtectedRoute>)}</RouteErrorBoundary>} />
      {/* Q2437: Find a Helpr (browse by skill and town, offer a job at your price). */}
      <Route path="/helprs" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><FindHelprs /></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/jobs/settings" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute><PageTransition><JobsSettings /></PageTransition></ProtectedRoute>)}</RouteErrorBoundary>} />
      <Route path="/jobs/:id" element={<RouteErrorBoundary>{routeEl(<ProtectedRoute allowGuest><PageTransition><JobDetail /></PageTransition></ProtectedRoute>)}</RouteErrorBoundary>} />
      {/* Guest "home dashboard" — what iOS native users see before signing up.
          Mirrors /home's chrome and JobCard rendering, but every action
          routes to /signup. Public web visitors can hit it too if they want
          a no-account preview, though the marketing landing remains canonical.

          WRAPPED IN <MarketingRedirect>, like `/` and for the same reason.
          DashboardGuest DOES redirect a signed-in visitor to /home — but
          it decides that from `supabase.auth.getSession()`, INSIDE the route
          chunk, so the guest chunk and the Supabase client both had to
          download before the redirect could even be considered. Measured on a
          cold 375x812 slow-3G load: a signed-in user got the full guest browse
          page — chips row, guest header, "Log in / Sign up" — for ~10s, and
          then the entire screen swapped to the dashboard. The placeholder was
          not a placeholder; it was the wrong page.

          MarketingRedirect's synchronous `hasPersistedAuthToken()` probe
          answers on the first tick with no Supabase and no chunk, so a
          token-holding visitor never renders DashboardGuest at all. Its
          fallback is DashboardRouteSkeleton — the shape of where they are
          GOING, so the redirect lands in a frame it keeps.

          Guests are untouched: the probe returns false, `children` renders on
          exactly the same tick as before, and GuestBrowseSkeleton is still the
          chunk fallback. Native is untouched too — MarketingRedirect is a
          no-op there, and NativeLaunchRouter already owns that decision.
          DashboardGuest's own redirect stays as the floor under a stale or
          revoked token. */}
      <Route path="/browse" element={<RouteErrorBoundary><MarketingRedirect fallback={<DashboardRouteSkeleton />}>{routeEl(<PageTransition><DashboardGuest /></PageTransition>, <GuestBrowseSkeleton />)}</MarketingRedirect></RouteErrorBoundary>} />
      {/* Same exception as /terms and /privacy above — a policy document, not
          marketing. No signed-in bounce. Real route, not a redirect, for the
          same reason (owner, 2026-09-11) — see the comment above /terms. */}
      <Route path="/rules" element={<RouteErrorBoundary>{routeEl(<PageTransition><Legal /></PageTransition>)}</RouteErrorBoundary>} />
      {/* NO LEGACY REDIRECT ROUTES (owner, 2026-09-23, Q194: "The old address
          shouldn't be redirects, it should be direct"). /activity, /earnings,
          /warnings, /schedule, /availability, /saved-helprs, /saved-helpers,
          /gift-card, /help-center, /settings, /data-rights and the short-link
          shapes /j/:id, /u/:id, /m/:id, /messages/:id, /post-job/*, /legal/:tab
          were all redirect-only hops. Every emitter (client code, SQL
          functions, edge functions, gift email, stored notifications.link
          rows) now writes the current address instead, and the routes are
          gone: an old address is a 404. The app has not launched (owner), so no
          installed build or sent email carries one; the App Store metadata
          (fastlane/metadata/en-US/*_url.txt) names /privacy, /support and the
          root, never a redirect. src/test/everyLinkIsARealRoute.test.ts keeps
          both halves shut. */}
      {/* /analytics — Advanced Analytics, the perk printed on the $10 Pro card.
          It was a <Navigate> to the Earnings tab from 2026-08-23, and that was
          the right call at the time: the old page rendered the SAME body as the
          Earnings tab under a different title, so it was a second screen for one
          subject. This is not that page returning. An audit found the Pro bullet
          pointed at nothing — every free helper already had the tab it
          redirected to — and the owner chose to build the perk rather than drop
          the bullet. The new page answers "how do I earn more" (fee split,
          category vs market rates, application funnel, posting clock); the
          Earnings tab keeps "what did I make and where is the money". Half of
          this page's data is other people's jobs, which a helper cannot read at
          all, so it could never have lived on the Earnings tab.
          Gated in SQL: get_helper_analytics() returns entitled:false to
          non-subscribers and the page renders an upgrade offer, not a locked
          copy of the dashboard. */}
      {/* Public vertical landing pages */}


      {/* /become-a-partner, /enterprise and /how-it-works were retired, and
          their redirect stubs deleted in 2352466e. These comments used to say
          the links were redirected "so they don't 404" — they are not; all
          three now render NotFound. Left as a note rather than a promise:
          error_logs shows zero hits on any of them in 90 days and none appear
          in sitemap.xml, so no redirect is warranted. If that changes, add a
          real <Route>, not a comment claiming one exists. */}
      {/* NOT wrapped in <MarketingRedirect>. /help IS the in-app help screen
          already — PublicLayout swaps its marketing chrome for AppShell on
          native — and the Profile support tab links INTO it ("Browse the Help
          Center"), so it is upstream of the in-app surface, not a marketing
          duplicate of it. Support must stay reachable from anywhere. */}
      <Route path="/help" element={<RouteErrorBoundary>{routeEl(<PageTransition><HelpCenter /></PageTransition>)}</RouteErrorBoundary>} />
      {/* OPS-4: town + service pages for Google ("Handyman in Baton Rouge"), open to anyone; src/lib/townPages.ts. */}
      <Route path="/hire/:service/:town" element={<RouteErrorBoundary>{routeEl(<PageTransition><HireTownPage /></PageTransition>)}</RouteErrorBoundary>} />
      {/* Twilio A2P review (owner 2026-10-23): a public link to how members opt in to texts. */}
      <Route path="/sms-opt-in" element={<RouteErrorBoundary>{routeEl(<PageTransition><SmsOptIn /></PageTransition>)}</RouteErrorBoundary>} />
      {/* /parishes, /parish/:slug, /impact, /local-guide, /community and
          /browse-jobs were removed along with their redirect stubs (2352466e).
          Same as above: no redirect exists, and none is warranted on current
          evidence. */}
      {/* Helpr Wrapped — auth-gated at the route level so a logged-out
          visitor never sees a flash of authed chrome (HelprWrapped's own
          useEffect redirect used to fire only after the first paint). */}
      {/* /benefits (BenefitsPage) was removed 2026-08-31 (owner): there were
          no partner agreements behind it — every row was a plain link to a
          public third-party site, so the screen made a promise the product
          could not honour. Deleted outright rather than retitled. NO redirect,
          for the same reason as the retired routes above: nothing outside the
          app cites the URL (it is absent from sitemap.xml, robots.txt, the App
          Store metadata, every email/push template and every legal page — it
          was a ProtectedRoute reachable only from the Profile → Work group),
          so it falls through to the `path="*"` NotFound below. If an external
          citation ever appears, add a real <Route>, not a comment. */}
      {/* Pet care — manage pet profiles and vet notes */}
      {/* /evacuation was removed; its redirect to /pets went with it in
          2352466e. The path now 404s. */}
      <Route path="*" element={<RouteErrorBoundary>{routeEl(<NotFound />)}</RouteErrorBoundary>} />
    </Routes>
  );
});
AnimatedRoutes.displayName = "AnimatedRoutes";

// Page-level error boundary, re-keyed by route. A render crash on one
// page shows the fallback inside <main> only — the header, nav, and
// banners stay mounted — and navigating elsewhere clears it. The root
// ErrorBoundary in <App> still backstops crashes in the shell itself.
//
// No outer <Suspense> here on purpose: every lazy route element brings
// its own per-route Suspense (see `routeEl()` above). A single shared
// Suspense at this level would tear down the active route's UI during a
// nav transition — by scoping the fallback per route, the previous
// route's content stays mounted until the next chunk resolves, so the
// persistent shell never flashes blank between pages.
const RoutedBoundary = () => {
  const location = useLocation();
  // "Report a bug" names the screen the person came from (Q1028).
  useBugReportScreen(location);
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <AnimatedRoutes />
    </ErrorBoundary>
  );
};


const App = () => (
  <ErrorBoundary>
    {/* Plain QueryClientProvider — see components/QueryCacheHydrator.tsx for why we
        don't use PersistQueryClientProvider. Returning users still see
        last-known dashboard/jobs/messages once IDB hydrates, but queries
        no longer wait on IDB before firing against the network. See
        src/lib/queryPersister.ts. */}
    <QueryClientProvider client={queryClient}>
      <QueryCacheHydrator />
      {/* Toasters mount AFTER first paint via DeferredToasters — see comment
          on that component (components/DeferredToasters.tsx). Its lazy() wrappers keep
          the chunks out of the entry bundle. */}
      <DeferredToasters />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md">
        Skip to content
      </a>
      {/* ForceUpdateGate sits OUTSIDE the router, above AppLockGate, and is
          the outermost thing in the tree that can replace the app.
          · Outside the router because it is not a route and has none: its only
            navigation is an external App Store link, so it must not depend on
            the router — or on any of the app it is refusing to run — to work.
          · Above AppLockGate because when both apply (an out-of-date install
            with Face ID enabled) this one must win. Demanding a biometric
            before telling someone their app is dead is the wrong first screen,
            and there is no account data on this one to protect.
          It renders children untouched on the web and on any native install
          that is up to date, gate-off, or unable to answer the question — see
          hooks/useVersionCheck.ts for why every uncertainty lets the user in. */}
      <ForceUpdateGate>
      <BrowserRouter>
        {/* Provider wraps the banner (publisher of its measured height) and
            the page content (AppShell reads the offset to reserve space).
            See src/lib/offlineBannerLayout.tsx. */}
        {/* AppLockGate wraps everything inside the router so the lock covers
            the entire authed surface (nav, banners, routes) — not just the
            page body. It renders children untouched unless the user opted in
            via Profile → Security, and only ever locks a signed-in session. */}
        <AppLockGate>
        <OfflineBannerLayoutProvider>
          <Suspense fallback={null}><ScrollToTop /></Suspense>
          <SessionManager />
          <NativeLaunchRouter />
          {/* Writes the route NativeLaunchRouter reads back on a native
              resume. Order between the two does not matter: this records
              subsequent navigations, that one consumes the value once at
              mount. */}
          <RouteMemory />
          <StaleClientWatch />
          <OfflineBanner />
          <SignedInOnly>
            <Suspense fallback={null}>
              <StrikeBanner />
            </Suspense>
          </SignedInOnly>
          <SidePanelProvider>
          <main
            id="main-content"
            className="w-full max-w-full no-scrollbar"
          >
            <RoutedBoundary />
          </main>
          {/* A lazy chunk is fetched as soon as it renders, so these wait for a
              maybe-signed-in visitor: a guest draws none of them. The rationale
              dialog stays out: anyone can be asked for a device permission. */}
          {/* One Suspense per piece (B83, 11-01): under one shared boundary
              the dock waited for the slowest chunk beside it, and drew ~1.6 s
              after /home was ready on Slow 4G (lab, main and b78/b79 alike).
              The Terms and ID mounts are small chunks that fetch their dialogs only
              when one has to show. Guard: chromeWaitsOnlyForItsOwnCode. */}
          <SignedInChrome>
            <Suspense fallback={null}><MobileNav /></Suspense>
            <Suspense fallback={null}><NeedsYouMount /></Suspense>
            {/* Phones never fetch the desktop rail's chunks (B86). */}
            <WebDesktopOnly>
              <Suspense fallback={null}><DesktopSidebarNav /></Suspense>
              <Suspense fallback={null}><DesktopTopNav /></Suspense>
            </WebDesktopOnly>
            <Suspense fallback={null}><DeliveryOnlinePill /></Suspense>
            <Suspense fallback={null}><TermsReconsentMount /></Suspense>
            <Suspense fallback={null}><IdentityCheckMount /></Suspense>
          </SignedInChrome>
          <Suspense fallback={null}>
            <PermissionRationaleMount />
          </Suspense>
          </SidePanelProvider>
          <SpeedInsightsRouted />
        </OfflineBannerLayoutProvider>
        </AppLockGate>
      </BrowserRouter>
      </ForceUpdateGate>
      <Analytics />
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
