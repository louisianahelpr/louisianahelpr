import Navbar from "@/components/Navbar";
import HeroSection from "@/components/landing/HeroSection";
import SocialProofSection from "@/components/landing/SocialProofSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import HelperSpotlightSection from "@/components/landing/HelperSpotlightSection";
import JobStoriesSection from "@/components/landing/JobStoriesSection";
import PublicJobsPreview from "@/components/landing/PublicJobsPreview";
import CTASection from "@/components/landing/CTASection";
import CommunityLoveSection from "@/components/landing/CommunityLoveSection";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";

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
      <Navbar />
      <HeroSection />
      <SocialProofSection />
      <HowItWorksSection />
      <FeaturesSection />
      <HelperSpotlightSection />
      <JobStoriesSection />
      <CommunityLoveSection />
      <CTASection />
      <Footer />
    </div>
  );
};

export default Index;
