import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FeaturesSection from "@/components/landing/FeaturesSection";
import { usePageMeta } from "@/hooks/usePageMeta";

const Features = () => {
  usePageMeta({
    title: "Features — Why Louisiana trusts Helpr",
    description:
      "Vetted helprs, escrow payments, honest reviews, and Louisiana-local matching. Six reasons Louisiana neighbors choose Helpr.",
    canonical: "https://louisianahelpr.com/features",
  });

  return (
    <div className="min-h-screen bg-premium-page">
      <Navbar />
      <main className="pt-20">
        <FeaturesSection />
      </main>
      <Footer />
    </div>
  );
};

export default Features;
