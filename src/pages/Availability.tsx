import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { HelperAvailability } from "@/components/HelperAvailability";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";

const Availability = () => {
  usePageTitle("Availability — Helpr");
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.documentElement.classList.add("availability-screen-lock");
    const stopScroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-allow-scroll='true']")) return;
      event.preventDefault();
    };
    document.addEventListener("wheel", stopScroll, { passive: false });
    document.addEventListener("touchmove", stopScroll, { passive: false });
    return () => {
      document.documentElement.classList.remove("availability-screen-lock");
      document.removeEventListener("wheel", stopScroll);
      document.removeEventListener("touchmove", stopScroll);
    };
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (!session?.user) {
        navigate("/login");
        return;
      }
      setUserId(session.user.id);
      setLoading(false);
    });
    return () => { active = false; };
  }, [navigate]);

  return (
    <div className="h-[100dvh] max-h-[100dvh] flex flex-col bg-premium-page overflow-hidden">
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
        <div className="max-w-3xl w-full mx-auto flex-1 min-h-0 flex flex-col px-3 pt-1 pb-[calc(env(safe-area-inset-bottom,0px)+5rem)] overflow-hidden">
          <div className="flex items-center gap-2 shrink-0 mb-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
              aria-label="Go back"
              className="h-10 w-10 shrink-0 rounded-xl -ml-1"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex flex-col leading-none">
              <span
                className="font-serif italic uppercase text-[0.62rem]"
                style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
              >
                Your weekly hours
              </span>
              <h1
                className="font-display italic font-bold leading-tight mt-1"
                style={{ fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.75rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
              >
                Availability
              </h1>
            </div>
          </div>

          <p className="font-serif italic text-[0.78rem] leading-snug mb-1 px-1 shrink-0" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
            Set your weekly hours so posters can match jobs to days you're free.
          </p>

          <div className="flex-1 min-h-0 rounded-xl liquid-glass overflow-hidden flex flex-col">
            {loading || !userId ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="h-5 w-20 rounded bg-muted/40 animate-pulse" />
                    <div className="flex-1 h-9 rounded-md bg-muted/30 animate-pulse" />
                    <div className="h-9 w-9 rounded-md bg-muted/30 animate-pulse" />
                  </div>
                ))}
              </div>
            ) : (
              <HelperAvailability userId={userId} compact />
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Availability;
