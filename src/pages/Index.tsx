import { lazy, Suspense, useEffect } from "react";
import { useLocation } from "react-router-dom";
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

// Minimal landing — Hero → How it works → Footer. Live-jobs strip
// removed per user request; the hero is the only thing above the fold.
import HeroSection from "@/components/landing/HeroSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";

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

  // Stagger fade-up on every `.observe-fade-up` element as it scrolls into
  // view. Honors prefers-reduced-motion. Picks up newly-mounted lazy
  // sections via the hook's mount-time DOM query.
  useScrollFadeUp();

  usePageMeta({
    title: "Helpr — Louisiana's Local Job Partner | Hire or Find Work",
    description:
      "Hire a Helpr or find local work in Louisiana. For everyday jobs, big and small — post or apply in minutes across New Orleans, Baton Rouge & beyond.",
    keywords:
      "Louisiana helprs, local help, cleaning services Louisiana, yard work New Orleans, moving help Baton Rouge, errands Shreveport, handyman Lafayette, job marketplace, trusted neighbors, home services Louisiana",
    canonical: SITE_URL,
    ogTitle: "Helpr — Louisiana's Local Job Partner",
    ogDescription:
      "Hire a Helpr or find local work. For everyday jobs, big and small — Louisiana's trusted marketplace.",
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
      {/* Hero is the only thing on the fold — title, subhead, CTAs,
          nothing else. Live-jobs strip and 3-dot divider removed per
          user request. Hero fills exactly one viewport; HIW sits below
          the fold naturally. */}
      <HeroSection />

      {/* Scroll hint removed — was getting cut off at the bottom of the
          first viewport, and the moving marquee itself is enough of an
          invitation to keep scrolling. */}

      <HowItWorksSection />
    </PublicLayout>
  );
};

export default Index;
