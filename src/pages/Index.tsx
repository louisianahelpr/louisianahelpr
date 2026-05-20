import { lazy, Suspense, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useScrollFadeUp } from "@/hooks/useScrollFadeUp";

// Navbar lazy-loaded so it doesn't compete with the LCP hero image for the
// main thread. The hero image preload + inline shell paint instantly;
// Navbar slides in within a few hundred ms after.
const Navbar = lazy(() => import("@/components/Navbar"));

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
const HowItWorksSection = lazy(() => import("@/components/landing/HowItWorksSection"));
const CommunityVoice = lazy(() => import("@/components/landing/CommunityVoice"));
// PayoutTicker is below the fold (it lives between the hero and the
// city strip) so it's safe to lazy-load — keeps the supabase chunk
// out of the LCP path. The ticker hides itself on empty / errored
// data, so a render-failure of the chunk degrades cleanly to nothing.
const PayoutTicker = lazy(() => import("@/components/landing/PayoutTicker"));

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
  description: "Connect with trusted neighbors in Louisiana for everyday tasks — cleaning, yard work, moving, errands & more.",
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
        text: "Helpr is Louisiana's trusted marketplace that connects you with verified neighbors for everyday tasks like cleaning, yard work, moving, errands, and handyman jobs.",
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
        text: "Signing up and browsing Helpr is free. You only pay when you hire a helpr, and pricing is set per job.",
      },
    },
  ],
};

const Index = () => {
  const isNative = typeof window !== "undefined" && Capacitor.isNativePlatform();
  const location = useLocation();

  // Stagger fade-up on every `.observe-fade-up` element as it scrolls into
  // view. Honors prefers-reduced-motion. Picks up newly-mounted lazy
  // sections via the hook's mount-time DOM query.
  useScrollFadeUp();

  usePageMeta({
    title: "Helpr — Louisiana's #1 Local Help Marketplace | Cleaning, Moving, Errands & More",
    description:
      "Find trusted helprs in New Orleans, Baton Rouge, Shreveport & across Louisiana for cleaning, yard work, moving, errands, and handyman tasks. Post a job in minutes.",
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
      <Suspense fallback={<div className="min-h-screen bg-background" />}>
        <NativeRedirect />
      </Suspense>
    );
  }


  return (
    <div className="min-h-screen page-warmth relative">
      {/* Global mesh — fixed-position behind every section so glass surfaces
          have refracting motion all the way down the page. Subtle. */}
      <div aria-hidden className="mesh-gradient-global" />
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
      <Suspense fallback={null}>
        <Navbar />
      </Suspense>
      <HeroSection />

      {/* Live payout ticker (#87) — single-line social-proof strip
          between the hero CTAs and the city strip, telling prospective
          helpers "real people are getting paid here right now."
          Self-hides when there's no recent payout data OR when the
          public RPC hasn't been pushed yet (PGRST202 fallback), so a
          fresh / quiet platform doesn't show an empty placeholder. */}
      <div className="px-5 sm:px-8 lg:px-12 pt-10 sm:pt-12 lg:pt-14">
        <Suspense fallback={null}>
          <PayoutTicker />
        </Suspense>
      </div>

      {/* City strip — sense-of-place transition between hero and process,
          replacing the previous "hugs the marquee" placement inside the
          hero with proper breathing room above the Three Steps section. */}
      <div className="px-5 sm:px-8 lg:px-12 pt-12 sm:pt-16 lg:pt-20 pb-4 sm:pb-6">
        <p
          className="text-center font-serif italic text-ds-11 sm:text-ds-13 tracking-[0.18em] uppercase"
          style={{ color: "hsl(var(--burnt-sienna))", opacity: 0.55 }}
        >
          Serving New Orleans · Baton Rouge · Lafayette · Shreveport · Lake
          Charles
        </p>
      </div>

      <Suspense fallback={<div className="h-64" />}>
        <HowItWorksSection />
      </Suspense>
      <Suspense fallback={<div className="h-96" />}>
        <CommunityVoice />
      </Suspense>

      {/* 120px breathing room before the footer so the FAQ accordion
          doesn't crash into the footer surface. */}
      <div aria-hidden className="h-30" style={{ height: "120px" }} />

      <Footer />
    </div>
  );
};

export default Index;
