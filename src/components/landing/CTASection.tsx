import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const CTASection = () => {
  const navigate = useNavigate();

  return (
    <section className="py-24 px-4">
      <div className="container mx-auto">
        <div className="rounded-2xl bg-primary p-12 sm:p-16 text-center">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-primary-foreground mb-4">
            Ready to get started?
          </h2>
          <p className="text-primary-foreground/80 max-w-md mx-auto mb-8">
            Join your Louisiana neighbors on Helpr to get things done — or earn extra income helping others.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button
              variant="hero-outline"
              size="xl"
              className="border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary"
              onClick={() => navigate("/signup")}
            >
              Sign up free
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
