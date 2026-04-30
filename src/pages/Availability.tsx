import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { HelperAvailability } from "@/components/HelperAvailability";
import { Loader2 } from "lucide-react";

const Availability = () => {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.documentElement.classList.add("availability-screen-lock");
    return () => {
      document.documentElement.classList.remove("availability-screen-lock");
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
    <div className="h-[100dvh] flex flex-col bg-premium-page overflow-hidden">
      <PageHeader title="Availability" />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="max-w-3xl mx-auto h-full flex flex-col px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+5rem)]">
          <p className="text-xs text-muted-foreground mb-2 px-1">
            Set your weekly hours so posters can match jobs to days you're free.
          </p>

          <div className="flex-1 min-h-0 rounded-xl border border-border bg-card overflow-hidden">
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
