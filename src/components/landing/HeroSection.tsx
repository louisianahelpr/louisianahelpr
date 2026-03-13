import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import heroWebp from "@/assets/hero-illustration.webp";
import heroJpg from "@/assets/hero-illustration.jpg";
import heroV3 from "@/assets/hero-illustration-v3.jpg";
import heroV4 from "@/assets/hero-illustration-v4.jpg";
import heroV5 from "@/assets/hero-illustration-v5.jpg";

const HeroSection = () => {
  const navigate = useNavigate();
  const [comparing, setComparing] = useState(true);

  return (
    <section className="pt-32 pb-20 px-4">
      <div className="container mx-auto">
        {comparing ? (
          <div className="space-y-6 animate-fade-in">
            <h2 className="text-2xl font-display font-bold text-foreground text-center">Compare Hero Images</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground text-center">Current</p>
                <img src={heroJpg} alt="Current hero" className="w-full rounded-2xl shadow-lg" />
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground text-center">v3 — Simple yard</p>
                <img src={heroV3} alt="Hero v3" className="w-full rounded-2xl shadow-lg" />
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground text-center">v4 — Festival scene</p>
                <img src={heroV4} alt="Hero v4 festival" className="w-full rounded-2xl shadow-lg" />
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground text-center">v5 — Community helping</p>
                <img src={heroV5} alt="Hero v5 community" className="w-full rounded-2xl shadow-lg" />
              </div>
            </div>
            <p className="text-center text-sm text-muted-foreground">Tell me which one you prefer!</p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6 animate-fade-in">
              <div className="inline-block px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium tracking-wide uppercase">
                Serving Louisiana communities
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold text-foreground leading-tight text-balance">
                Louisiana's helping hand for everyday tasks
              </h1>
              <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">
                Helpr connects you with trusted neighbors across Louisiana for everyday tasks — cleaning, errands, moving, yard work, and more.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button variant="hero" size="xl" onClick={() => navigate("/signup")}>
                  Post your first task
                </Button>
                <Button variant="hero-outline" size="xl" onClick={() => navigate("/login")}>
                  Offer help today
                </Button>
              </div>
            </div>
            <div className="animate-fade-in [animation-delay:200ms] opacity-0">
              <picture>
                <source srcSet={heroWebp} type="image/webp" />
                <img src={heroJpg} alt="Diverse Louisiana neighbors helping each other with everyday tasks under Spanish moss oak trees" className="w-full rounded-2xl shadow-lg" loading="eager" width={1200} height={1200} />
              </picture>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default HeroSection;
