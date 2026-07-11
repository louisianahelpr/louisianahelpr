import { lazy, Suspense, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import PublicLayout from "@/components/marketing/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useScrollFadeUp } from "@/hooks/useScrollFadeUp";

// IMPORTANT: do NOT import useCurrentUser at the top of Index. It pulls
// @supabase/supabase-js into the Index entry chunk (~50 KiB), blocking the
// LCP image discovery. We only need the auth user inside the native-app
// redirect path; load that hook lazily so web visitors never download
// Supabase before paint.
const NativeRedirect = lazy(() => import("@/components/NativeRedirect"));

// HeroSection is eager-loaded — it's above the fold on every visit and
// the LCP element. Lazy-loading it added a network round-trip (entry chunk →
// Index chunk → HeroSection chunk → image) that pushed LCP / Speed Index
// past 3s. Below-the-fold sections stay lazy so they don't compete for
// bandwidth with the hero image during initial paint.
import HeroSection from "@/components/landing/HeroSection";
import CategoryBento from "@/components/landing/CategoryBento";
// HowItWorks / CommunityVoice / BusinessCTA are eager-loaded. They're pure
// presentational sections (lucide icons + router + Button, no Supabase), so
// they add negligible JS to the entry chunk — but lazy-loading them caused
// visible layout shift (the Suspense height reservations never matched the
// real rendered height, so the page lurched as each chunk streamed in).
// Rendering them synchronously reserves their true height up front → no CLS.
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import CommunityVoice from "@/components/landing/CommunityVoice";
import BusinessCTASection from "@/components/landing/BusinessCTASection";
// PayoutTicker is below the fold (it lives between the hero and the
// city strip) so it's safe to lazy-load — keeps the supabase chunk
// out of the LCP path. The ticker hides itself on empty / errored
// data, so a render-failure of the chunk degrades cleanly to nothing.
const PayoutTicker = lazy(() => import("@/components/landing/PayoutTicker"));
// LandingJobsStrip self-fetches open jobs (pulls in Supabase), so it MUST stay
// lazy to keep the supabase chunk out of the Index entry / LCP path. Like the
// ticker it hides itself on empty / errored / not-yet-deployed (PGRST202) data,
// so a render failure degrades cleanly to nothing. Its `id="jobs"` is the
// scroll target for the nav's "Jobs" link.
const LandingJobsStrip = lazy(() => import("@/components/landing/LandingJobsStrip"));

const SITE_URL = "https://www.louisianahelpr.com";

const louisianaCities = [
  "New Orleans", "Baton Rouge", "Shreveport", "Lafayette", "Lake Charles",
  "Kenner", "Bossier City", "Monroe", "Alexandria", "Houma",
];

// LocalBusiness + Organization schema is served statically from
// index.html so non-JS crawlers see it — see that file's <head>.

const breadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: SITE_URL,
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "For Business",
      item: `${SITE_URL}/for-business`,
    },
    {
      "@type": "ListItem",
      position: 3,
      name: "Legal",
      item: `${SITE_URL}/legal`,
    },
  ],
};

const webAppSchema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Helpr",
  description: "Connect with trusted neighbors in Louisiana for everyday jobs — cleaning, yard work, moving, errands & more.",
  url: SITE_URL,
  applicationCategory: "Marketplace",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  areaServed: { "@type": "State", name: "Louisiana" },
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is Helpr?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Helpr is Louisiana's trusted marketplace that connects you with verified neighbors for everyday jobs like cleaning, yard work, moving, errands, and handyman jobs.",
      },
    },
    {
      "@type": "Question",
      name: "Where does Helpr operate?",
      acceptedAnswer: {
        "@type": "Answer",
        text: `Helpr currently serves communities across Louisiana, including ${louisianaCities.slice(0, 5).join(", ")}, and more.`,
      },
    },
    {
      "@type": "Question",
      name: "How much does it cost to use Helpr?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Signing up and browsing Helpr is free. You only pay when you hire a Helpr, and pricing is set per job.",
      },
    },
  ],
};

const Index = () => {
  const isNative = typeof window !== "undefined" && Capacitor.isNativePlatform();
  const location = useLocation();
  const navigate = useNavigate();

  // Category rail lives ABOVE the hero (right under the fixed nav) as a
  // browse-affordance strip — same auth-aware routing the hero CTAs use:
  // logged-in visitor → /post-job; anonymous visitor → /signup.
  const handleCategorySelect = async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    navigate(session?.user ? "/post-job" : "/signup");
  };

  // Stagger fade-up on every `.observe-fade-up` element as it scrolls into
  // view. Honors prefers-reduced-motion. Picks up newly-mounted lazy
  // sections via the hook's mount-time DOM query.
  useScrollFadeUp();

  usePageMeta({
    title: "Helpr — Louisiana's Local Help Marketplace | Cleaning, Moving, Errands & More",
    description:
      "Find trusted Helprs in New Orleans, Baton Rouge, Shreveport & across Louisiana for cleaning, yard work, moving, errands, and handyman jobs. Post a job in minutes.",
    keywords:
      "Louisiana helprs, local help, cleaning services Louisiana, yard work New Orleans, moving help Baton Rouge, errands Shreveport, handyman Lafayette, task marketplace, trusted neighbors, home services Louisiana",
    canonical: SITE_URL,
    ogTitle: "Helpr — Louisiana's Trusted Marketplace for Everyday Tasks",
    ogDescription:
      "Connect with verified neighbors in Louisiana for cleaning, moving, yard work, errands & more. Post a job and get help today.",
    geoRegion: "US-LA",
    geoPlacename: "Louisiana",
  });

  // Scroll to hash target after lazy-loaded sections mount.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    let attempts = 0;
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (attempts++ < 20) setTimeout(tryScroll, 150);
    };
    tryScroll();
  }, [location.hash, location.pathname]);

  // iOS/Android native app: skip the marketing landing entirely. The redirect
  // logic (which needs Supabase auth) is in a separate lazy chunk so web
  // visitors don't pay the 50 KiB Supabase tax for a code path they never hit.
  if (isNative) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-premium-page" />}>
        <NativeRedirect />
      </Suspense>
    );
  }


  return (
    <PublicLayout showCtaBand={false} noNavSpacer>
      {/* LocalBusiness + Organization JSON-LD is in index.html (static,
          crawlable without JS). These page-specific schemas stay here. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      {/* Category rail — moved back ABOVE the hero (under the fixed nav)
          at user request. Custom top padding clears the h-12 navbar +
          safe-area since PublicLayout is `noNavSpacer` on the landing.
          Hero below is compressed so the H1 still fits above the fold. */}
      <div
        className="px-5 sm:px-8 lg:px-12"
        style={{ paddingTop: "calc(max(env(safe-area-inset-top), 0.5rem) + 3rem)" }}
      >
        <CategoryBento onSelect={handleCategorySelect} />
      </div>

      <HeroSection />

      {/* Live payout ticker (#87) — single-line social-proof strip
          between the hero CTAs and the city strip, telling prospective
          helpers "real people are getting paid here right now."
          Self-hides when there's no recent payout data OR when the
          public RPC hasn't been pushed yet (PGRST202 fallback), so a
          fresh / quiet platform doesn't show an empty placeholder. */}
      <div className="px-5 sm:px-8 lg:px-12 pt-3 sm:pt-4">
        <Suspense fallback={null}>
          <PayoutTicker />
        </Suspense>
      </div>

      {/* City strip now lives inside the hero-footer band (HeroSection),
          grouped with the App Store download + category marquee. */}

      <HowItWorksSection />

      {/* Live open-jobs strip (#62) — sits right after "how it works" so a
          visitor who just learned the flow immediately sees real work
          happening. Lazy + self-hiding, so it never blocks paint and never
          shows an empty rail on a quiet platform. */}
      <Suspense fallback={null}>
        <LandingJobsStrip />
      </Suspense>

      {/* Business band sits directly under the live-jobs strip, then the
          reviews + FAQ (CommunityVoice) close the page — so the scroll reads
          how-it-works → real jobs → business offering → social proof/answers. */}
      <BusinessCTASection />
      <CommunityVoice />

      {/* 120px breathing room before the footer so the FAQ accordion
          doesn't crash into the footer surface. */}
      <div aria-hidden style={{ height: "120px" }} />
    </PublicLayout>
  );
};

export default Index;
