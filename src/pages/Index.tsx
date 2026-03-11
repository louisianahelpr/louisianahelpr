import Navbar from "@/components/Navbar";
import HeroSection from "@/components/landing/HeroSection";
import SocialProofSection from "@/components/landing/SocialProofSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import HelperSpotlightSection from "@/components/landing/HelperSpotlightSection";
import JobStoriesSection from "@/components/landing/JobStoriesSection";
import CTASection from "@/components/landing/CTASection";
import Footer from "@/components/Footer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
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
