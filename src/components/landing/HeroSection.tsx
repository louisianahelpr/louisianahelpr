import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import heroImage from "@/assets/hero-illustration.jpg";

const HeroSection = () => {
  const navigate = useNavigate();

  return (
    <section className="pt-32 pb-20 px-4">
      <div className="container mx-auto grid lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-6 animate-fade-in">
          <div className="inline-block px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium tracking-wide uppercase">
            Your neighbourhood, connected
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold text-foreground leading-tight text-balance">
            Get help with the things that matter
          </h1>
          <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">
            Helpr connects you with trusted people nearby for everyday tasks — cleaning, errands, moving, yard work, and more.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button variant="hero" size="xl" onClick={() => navigate("/signup")}>
              Post a task
            </Button>
            <Button variant="hero-outline" size="xl" onClick={() => navigate("/signup")}>
              Become a Helper
            </Button>
          </div>
        </div>

        <div className="animate-fade-in [animation-delay:200ms] opacity-0">
          <img
            src={heroImage}
            alt="People helping each other with everyday tasks"
            className="w-full rounded-2xl shadow-lg"
          />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
