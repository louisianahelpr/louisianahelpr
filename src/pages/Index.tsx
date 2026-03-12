import Navbar from "@/components/Navbar";
import HeroSection from "@/components/landing/HeroSection";
import SocialProofSection from "@/components/landing/SocialProofSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import HelperSpotlightSection from "@/components/landing/HelperSpotlightSection";
import JobStoriesSection from "@/components/landing/JobStoriesSection";
import CTASection from "@/components/landing/CTASection";
import Footer from "@/components/Footer";
import { usePageTitle } from "@/hooks/usePageTitle";

const Index = () => {
  usePageTitle("Helpr — Louisiana's Helping Hand for Everyday Tasks");
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "Helpr",
            description: "Helpr connects you with trusted neighbors across Louisiana for cleaning, errands, moving, yard work, and more.",
            url: "https://louisianahelpr.lovable.app",
            applicationCategory: "Marketplace",
            operatingSystem: "Web",
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "USD",
            },
            areaServed: {
              "@type": "State",
              name: "Louisiana",
            },
          }),
        }}
      />
      <Navbar />
      <HeroSection />
      <SocialProofSection />
      <HowItWorksSection />
      <FeaturesSection />
      <HelperSpotlightSection />
      <JobStoriesSection />
      <CTASection />
      <Footer />
    </div>
  );
};

export default Index;
