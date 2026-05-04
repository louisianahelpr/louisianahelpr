import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ClosingCTA — the final conversion moment before the footer. Visitors who
 * scrolled the whole page with rising interest get one more "ok, what now?"
 * landing zone. Bodoni 900 italic headline + Beth Ellen sage button +
 * micro-reassurance line.
 */
const ClosingCTA = () => {
  const navigate = useNavigate();

  const goToPostJob = async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    navigate(session?.user ? "/post-job" : "/signup");
  };

  return (
    <section className="px-5 sm:px-8 lg:px-12 py-16 sm:py-20 lg:py-24">
      <div className="liquid-glass container mx-auto max-w-2xl text-center observe-fade-up px-8 sm:px-12 py-12 sm:py-16">
        <span className="text-display-eyebrow">Ready when you are</span>
        <h2
          className="font-display font-black italic mt-4 text-balance leading-[0.95] tracking-[-0.04em] text-[2.5rem] sm:text-5xl lg:text-6xl"
          style={{ color: "hsl(var(--olivewood))" }}
        >
          Your neighbors are nearby.
        </h2>
        <p
          className="font-serif italic mt-5 sm:mt-6 text-lg sm:text-xl leading-snug max-w-md mx-auto"
          style={{ color: "hsl(var(--stormy-sky))", fontWeight: 500 }}
        >
          First post takes about 60 seconds. No card on file required.
        </p>

        <div className="mt-9 sm:mt-11 flex justify-center">
          <Button
            size="xl"
            onClick={goToPostJob}
            className="btn-liquid-fill group h-14 sm:h-16 px-8 rounded-2xl tracking-tight"
            style={{
              fontFamily: "\"Beth Ellen\", cursive",
              fontWeight: 400,
              fontSize: "1.25rem",
              lineHeight: 1,
              color: "hsl(var(--parchment))",
              backgroundColor: "hsl(var(--sage))",
              border: "1px solid hsl(var(--sage))",
              boxShadow:
                "inset 0 1px 0 0 rgba(255,255,255,0.25), 0 1px 2px rgba(0,0,0,0.04), 0 8px 32px -8px rgba(0,0,0,0.06)",
            }}
          >
            <Sparkles className="mr-2 w-5 h-5" strokeWidth={1.25} />
            Request Assistance
            <ArrowRight
              className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1"
              strokeWidth={1.25}
            />
          </Button>
        </div>
      </div>
    </section>
  );
};

export default ClosingCTA;
