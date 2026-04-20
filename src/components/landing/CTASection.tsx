import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import SocialShare from "@/components/SocialShare";

const CTASection = () => {
  const navigate = useNavigate();

  return (
    <section className="py-24 px-4">
      <div className="container mx-auto">
        <div className="rounded-2xl bg-primary p-12 sm:p-16 text-center">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-primary-foreground mb-4">
            Your next helping hand is one tap away.
          </h2>
          <p className="text-primary-foreground/80 max-w-md mx-auto mb-8">
            Join Louisiana neighbors getting things done — or earning extra income on their own schedule.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mb-6">
            <Button
              variant="hero-outline"
              size="xl"
              className="border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary"
              onClick={() => navigate("/signup")}
            >
              Create free account
            </Button>
            <Button
              variant="ghost"
              size="xl"
              className="text-primary-foreground hover:bg-primary-foreground/10"
              onClick={() => navigate("/jobs")}
            >
              Browse jobs first
            </Button>
          </div>
          <div className="flex justify-center">
            <div className="bg-primary-foreground/10 backdrop-blur-sm rounded-xl px-4 py-3 space-y-1.5">
              <p className="text-xs text-primary-foreground/70 font-medium">Tell a neighbor about Helpr</p>
              <SocialShare />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
