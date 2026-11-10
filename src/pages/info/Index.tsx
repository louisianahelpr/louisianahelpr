import { lazy, Suspense, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import PublicLayout from "@/components/marketing/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { LANDING_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { useScrollFadeUp } from "@/hooks/useScrollFadeUp";

// IMPORTANT: do NOT import useCurrentUser at the top of Index. It pulls
// @supabase/supabase-js into the Index entry chunk (~50 KiB), blocking the
// LCP image discovery. We only need the auth user inside the native-app
// redirect path; load that hook lazily so web visitors never download
// Supabase before paint.
const NativeRedirect = lazy(() => import("@/components/NativeRedirect"));

import HeroSection from "@/components/landing/HeroSection";
import { LandingPhotoBand } from "@/components/landing/LandingPhotoBand";
import { NearYouSection } from "@/components/landing/NearYouSection";
import { NeighborsSay } from "@/components/landing/NeighborsSay";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import { TrustAndJoin } from "@/components/landing/SectionsShowcase";

const SITE_URL = "https://www.louisianahelpr.com";


// LocalBusiness + Organization schema is served statically from
// index.html so non-JS crawlers see it — see that file's <head>.

// A BreadcrumbList used to be injected here claiming Home -> Legal. The
// homepage has no breadcrumb trail to /legal — nothing on this page links
// there in a breadcrumb sense — so the schema was simply fabricated
// (lh-seo-web audit finding SW-004, 2026-09-02). Removed rather than
// "fixed": the homepage doesn't have a breadcrumb trail at all (it's the
// root), so there is no true BreadcrumbList to give it. If /legal ever wants
// one, it belongs on that page, describing that page's own trail.

const webAppSchema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Louisiana Helpr",
  description: "Hire Louisiana neighbors for everyday jobs, find work nearby, or buy and sell used items on Declutter. One account.",
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
        text: "Helpr is Louisiana's local marketplace: hire neighbors for everyday jobs like yard work, moving and errands, find work nearby, or buy and sell used items on Declutter, all with one account.",
      },
    },
    {
      "@type": "Question",
      name: "Where does Helpr operate?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Helpr is open across Louisiana and busiest today in New Iberia and the towns around it.",
      },
    },
    {
      "@type": "Question",
      name: "How much does it cost to use Helpr?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Browsing Helpr is free. You pay when you hire a Helpr or buy an item, and you see the full price before you pay.",
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

  // Q401(b): title, description, canonical and og:* come from the same table
  // index.html's pre-JS tags are pinned to (src/lib/publicPageMeta.mjs).
  usePageMeta({
    ...LANDING_PAGE_META,
    keywords:
      "Louisiana Helprs, local jobs, Declutter, buy and sell used items, garage sale, yard work, moving help, errands, handyman, New Iberia, Delcambre, Acadiana",
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
    <PublicLayout noNavSpacer landing>
      {/* LocalBusiness + Organization JSON-LD is in index.html (static,
          crawlable without JS). These page-specific schemas stay here. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      {/* Direction A, "Porch and Parish" (owner 11-10; D014, the story order): the unchanged hero, real local photos,
          what is near you this week (jobs and Declutter items), what neighbors say, how it works, the safety band,
          then join. The hero (H1, subhead, fonts, colours, empty space) is LOCKED and untouched. */}
      <HeroSection />

      <LandingPhotoBand />

      <NearYouSection />

      <NeighborsSay />

      <HowItWorksSection />

      <TrustAndJoin />
    </PublicLayout>
  );
};

export default Index;
