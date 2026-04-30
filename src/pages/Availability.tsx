import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { HelperAvailability } from "@/components/HelperAvailability";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";

const Availability = () => {
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
        <div className="max-w-3xl w-full mx-auto flex-1 min-h-0 flex flex-col px-3 pt-2 pb-0 overflow-hidden">
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
            <h1 className="font-display text-2xl font-bold leading-tight text-foreground">Availability</h1>
          </div>

          <p className="text-[11px] leading-snug text-muted-foreground mb-1.5 px-1 shrink-0">
            Set your weekly hours so posters can match jobs to days you're free.
          </p>

          <div className="flex-1 min-h-0 rounded-xl border border-border bg-card overflow-hidden flex flex-col">
            {loading || !userId ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
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
