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
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader title="Availability" />

      <main className="container mx-auto px-5 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <p className="text-sm text-muted-foreground">
              Set your weekly working hours. Posters can match jobs to days and times you're free.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            {loading || !userId ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <HelperAvailability userId={userId} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Availability;
