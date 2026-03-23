import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Navigation, MapPin, Clock, CheckCircle2, Truck, Wrench, PartyPopper } from "lucide-react";
import { toast } from "sonner";

const STATUSES = [
  { key: "assigned", label: "Assigned", icon: Clock, color: "text-muted-foreground" },
  { key: "on_the_way", label: "On the Way", icon: Truck, color: "text-primary" },
  { key: "arrived", label: "Arrived", icon: MapPin, color: "text-primary" },
  { key: "working", label: "Working", icon: Wrench, color: "text-primary" },
  { key: "done", label: "Done", icon: PartyPopper, color: "text-primary" },
];

type TrackingData = {
  id: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  eta_minutes: number | null;
  updated_at: string;
};

export function JobTracking({
  jobId,
  helperId,
  isHelper,
  isOwner,
}: {
  jobId: string;
  helperId: string | null;
  isHelper: boolean;
  isOwner: boolean;
}) {
  const [tracking, setTracking] = useState<TrackingData | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!helperId) return;
    loadTracking();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`tracking-${jobId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_tracking", filter: `job_id=eq.${jobId}` },
        (payload) => {
          if (payload.new) setTracking(payload.new as TrackingData);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [jobId, helperId]);

  const loadTracking = async () => {
    const { data } = await supabase
      .from("job_tracking" as any)
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data && (data as any[]).length > 0) {
      setTracking((data as any[])[0]);
    }
  };

  const getLocation = (): Promise<{ lat: number; lng: number } | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 10000 }
      );
    });
  };

  const updateStatus = async (newStatus: string) => {
    if (!helperId) return;
    setUpdating(true);
    const loc = await getLocation();

    if (tracking) {
      await (supabase.from("job_tracking" as any) as any)
        .update({
          status: newStatus,
          latitude: loc?.lat || null,
          longitude: loc?.lng || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tracking.id);
    } else {
      await (supabase.from("job_tracking" as any) as any).insert({
        job_id: jobId,
        helper_id: helperId,
        status: newStatus,
        latitude: loc?.lat || null,
        longitude: loc?.lng || null,
      });
    }

    // Auto-transition job status based on tracking
    if (newStatus === "done") {
      await supabase.from("jobs").update({ status: "completed", helper_completed_at: new Date().toISOString() } as any).eq("id", jobId);
    } else if (["on_the_way", "arrived", "working"].includes(newStatus)) {
      const { data: job } = await supabase
        .from("jobs")
        .select("status")
        .eq("id", jobId)
        .single();
      if (job && job.status === "accepted") {
        await supabase.from("jobs").update({ status: "in_progress" } as any).eq("id", jobId);
      }
    }

    toast.success(`Status updated: ${STATUSES.find(s => s.key === newStatus)?.label}`);
    setUpdating(false);
    loadTracking();
  };

  const currentStatusIdx = tracking
    ? STATUSES.findIndex((s) => s.key === tracking.status)
    : 0;

  if (!helperId) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Navigation className="w-4 h-4 text-primary" /> Live Job Tracking
      </h3>

      {/* Progress timeline */}
      <div className="flex items-center gap-1">
        {STATUSES.map((s, idx) => {
          const isActive = idx <= currentStatusIdx;
          const isCurrent = idx === currentStatusIdx;
          const Icon = s.icon;
          return (
            <div key={s.key} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  isCurrent
                    ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background"
                    : isActive
                    ? "bg-primary/20 text-primary"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <span className={`text-[10px] font-medium text-center leading-tight ${
                isCurrent ? "text-primary" : isActive ? "text-foreground" : "text-muted-foreground"
              }`}>
                {s.label}
              </span>
              {idx < STATUSES.length - 1 && (
                <div className="sr-only">→</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${((currentStatusIdx + 1) / STATUSES.length) * 100}%` }}
        />
      </div>

      {/* ETA */}
      {tracking?.eta_minutes && tracking.status === "on_the_way" && (
        <p className="text-xs text-muted-foreground text-center">
          ETA: ~{tracking.eta_minutes} min
        </p>
      )}

      {/* Last update */}
      {tracking && (
        <p className="text-[10px] text-muted-foreground text-center">
          Last updated: {new Date(tracking.updated_at).toLocaleTimeString()}
          {tracking.latitude && (
            <span className="ml-2 inline-flex items-center gap-0.5">
              <MapPin className="w-2.5 h-2.5" />
              {tracking.latitude.toFixed(4)}, {tracking.longitude?.toFixed(4)}
            </span>
          )}
        </p>
      )}

      {/* Helper controls */}
      {isHelper && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          {STATUSES.filter((_, idx) => idx > currentStatusIdx).map((s) => (
            <Button
              key={s.key}
              size="sm"
              variant={s.key === STATUSES[currentStatusIdx + 1]?.key ? "default" : "outline"}
              onClick={() => updateStatus(s.key)}
              disabled={updating}
              className="text-xs"
            >
              <s.icon className="w-3.5 h-3.5 mr-1" />
              {s.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
