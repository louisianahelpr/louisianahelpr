import { lazy, Suspense, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";

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
const SocialProofSection = lazy(() => import("@/components/landing/SocialProofSection"));
const HowItWorksSection = lazy(() => import("@/components/landing/HowItWorksSection"));

const JobStoriesSection = lazy(() => import("@/components/landing/JobStoriesSection"));
const PublicJobsPreview = lazy(() => import("@/components/landing/PublicJobsPreview"));

const SITE_URL = "https://louisianahelpr.com";

const louisianaCities = [
  "New Orleans", "Baton Rouge", "Shreveport", "Lafayette", "Lake Charles",
  "Kenner", "Bossier City", "Monroe", "Alexandria", "Houma",
];

const localBusinessSchema = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": `${SITE_URL}/#business`,
  name: "Helpr",
  description: "Louisiana's trusted marketplace connecting neighbors for cleaning, yard work, moving, errands, handyman services, and more.",
  url: SITE_URL,
  logo: `${SITE_URL}/pwa-512x512.png`,
  image: `${SITE_URL}/pwa-512x512.png`,
  telephone: "",
  priceRange: "$$",
  areaServed: [
    { "@type": "State", name: "Louisiana", sameAs: "https://en.wikipedia.org/wiki/Louisiana" },
    ...louisianaCities.map((city) => ({
      "@type": "City",
      name: city,
      containedInPlace: { "@type": "State", name: "Louisiana" },
    })),
  ],
  geo: {
    "@type": "GeoCoordinates",
    latitude: 30.9843,
    longitude: -91.9623,
  },
  address: {
    "@type": "PostalAddress",
    addressRegion: "LA",
    addressCountry: "US",
  },
  sameAs: [],
  openingHoursSpecification: {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    opens: "00:00",
    closes: "23:59",
  },
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
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <Suspense fallback={<div className="h-16" />}>
        <Navbar />
      </Suspense>
      <HeroSection />
      <Suspense fallback={<div className="h-32" />}>
        <SocialProofSection />
      </Suspense>
      <Suspense fallback={<div className="h-64" />}>
        <HowItWorksSection />
      </Suspense>
      <Suspense fallback={<div className="h-64" />}>
        <PublicJobsPreview />
      </Suspense>
      <Suspense fallback={<div className="h-64" />}>
        <JobStoriesSection />
      </Suspense>
      <Footer />
    </div>
  );
};

export default Index;
