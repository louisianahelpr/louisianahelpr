import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatName } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { CalendarHeart, Pause, Play, XCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Retainer = {
  id: string;
  customer_id: string;
  helper_id: string;
  category: string;
  frequency: string;
  budget_per_session: number;
  discount_percent: number;
  status: string;
  next_job_date: string | null;
  description: string | null;
  created_at: string;
  helper_name?: string;
  customer_name?: string;
};

const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning",
  yard_work: "Yard Work",
  moving: "Moving",
  errands: "Errands",
  handyman: "Handyman",
  painting: "Painting",
  delivery: "Delivery",
  pet_care: "Pet Care",
  assembly: "Assembly",
  other: "Other",
};

export function MyRetainers({ userId, role }: { userId: string; role: string }) {
  const navigate = useNavigate();
  const [retainers, setRetainers] = useState<Retainer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRetainers();
  }, [userId]);

  const loadRetainers = async () => {
    const column = role === "helper" ? "helper_id" : "customer_id";
    const { data } = await supabase
      .from("retainer_agreements")
      .select("*")
      .eq(column, userId)
      .order("created_at", { ascending: false });

    if (data) {
      // Load profile names for the other party
      const otherIds = data.map((r: any) => role === "helper" ? r.customer_id : r.helper_id);
      const uniqueIds = [...new Set(otherIds)];
      
      if (uniqueIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", uniqueIds);
        
        const nameMap = new Map((profiles || []).map((p: any) => [p.user_id, p.full_name || "Unknown"]));
        
        const enriched = data.map((r: any) => ({
          ...r,
          helper_name: role === "helper" ? undefined : nameMap.get(r.helper_id) || "Unknown",
          customer_name: role === "helper" ? nameMap.get(r.customer_id) || "Unknown" : undefined,
        }));
        setRetainers(enriched as Retainer[]);
      } else {
        setRetainers(data as Retainer[]);
      }
    }
    setLoading(false);
  };

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase
      .from("retainer_agreements")
      .update({ status })
      .eq("id", id);
    if (error) {
      toast.error("Failed to update retainer");
    } else {
      toast.success(`Retainer ${status}`);
      loadRetainers();
    }
  };

  const statusColors: Record<string, string> = {
    active: "bg-primary/10 text-primary",
    paused: "bg-muted text-muted-foreground",
    cancelled: "bg-destructive/10 text-destructive",
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground text-center py-8">Loading retainers…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
          <CalendarHeart className="w-6 h-6 text-primary" /> Retainer Agreements
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {role === "helper"
            ? "Recurring bookings from your customers"
            : "Your recurring bookings with helprs"}
        </p>
      </div>

      {retainers.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-3">
          <CalendarHeart className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">
            {role === "helper"
              ? "No retainer agreements yet. Customers can set up recurring bookings from your profile."
              : "No retainer agreements yet. Visit a helpr's profile to set up recurring bookings."}
          </p>
          {role !== "helper" && (
            <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")}>
              Browse Helpers
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {retainers.map((r) => (
            <div key={r.id} className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-foreground text-sm">
                    {categoryLabels[r.category] || r.category}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {role === "helper" ? `Customer: ${r.customer_name}` : `Helper: ${r.helper_name}`}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[r.status] || "bg-muted text-muted-foreground"}`}>
                  {r.status}
                </span>
              </div>

              {r.description && (
                <p className="text-xs text-muted-foreground">{r.description}</p>
              )}

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-xs text-muted-foreground">Frequency</p>
                  <p className="text-sm font-semibold text-foreground capitalize">{r.frequency}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-xs text-muted-foreground">Per Session</p>
                  <p className="text-sm font-semibold text-foreground">${r.budget_per_session}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-xs text-muted-foreground">Discount</p>
                  <p className="text-sm font-semibold text-primary">{r.discount_percent}%</p>
                </div>
              </div>

              {r.next_job_date && (
                <p className="text-xs text-muted-foreground">
                  Next session: <span className="font-medium text-foreground">{new Date(r.next_job_date).toLocaleDateString()}</span>
                </p>
              )}

              {r.status === "active" && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => updateStatus(r.id, "paused")}>
                    <Pause className="w-3.5 h-3.5 mr-1" /> Pause
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 text-destructive hover:text-destructive" onClick={() => updateStatus(r.id, "cancelled")}>
                    <XCircle className="w-3.5 h-3.5 mr-1" /> Cancel
                  </Button>
                </div>
              )}
              {r.status === "paused" && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => updateStatus(r.id, "active")}>
                  <Play className="w-3.5 h-3.5 mr-1" /> Resume
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => navigate(`/user/${role === "helper" ? r.customer_id : r.helper_id}`)}
              >
                View Profile <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
