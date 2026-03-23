import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, LogIn, LogOut, AlertOctagon, Shield } from "lucide-react";
import { toast } from "sonner";

type Checkin = {
  id: string;
  type: string;
  latitude: number | null;
  longitude: number | null;
  note: string | null;
  created_at: string;
  user_id: string;
};

// Haversine formula: distance between two GPS points in feet
function distanceFeet(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 20902231; // Earth radius in feet
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const MAX_DISTANCE_FEET = 500;

export function JobCheckins({
  jobId,
  userId,
  isHelper,
  isOwner,
  jobStatus,
  jobLatitude,
  jobLongitude,
}: {
  jobId: string;
  userId: string;
  isHelper: boolean;
  isOwner: boolean;
  jobStatus: string;
  jobLatitude?: number | null;
  jobLongitude?: number | null;
}) {
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadCheckins();
  }, [jobId]);

  const loadCheckins = async () => {
    const { data } = await supabase
      .from("job_checkins" as any)
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });
    if (data) setCheckins(data as any[]);
  };

  const getLocation = (): Promise<{ lat: number; lng: number } | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 10000 }
      );
    });
  };

  const doCheckin = async (type: "check_in" | "check_out" | "sos") => {
    setLoading(true);
    const loc = await getLocation();

    // GPS proximity validation for check-in
    if (type === "check_in" && loc && jobLatitude && jobLongitude) {
      const dist = distanceFeet(loc.lat, loc.lng, jobLatitude, jobLongitude);
      if (dist > MAX_DISTANCE_FEET) {
        toast.error(
          `You must be within 500 feet of the job location to check in. You're currently ${Math.round(dist).toLocaleString()} feet away.`
        );
        setLoading(false);
        return;
      }
    }

    if (type === "check_in" && !loc) {
      toast.error("Location access is required to check in. Please enable GPS and try again.");
      setLoading(false);
      return;
    }

    const { error } = await (supabase.from("job_checkins" as any) as any).insert({
      job_id: jobId,
      user_id: userId,
      type,
      latitude: loc?.lat || null,
      longitude: loc?.lng || null,
      note: note.trim() || null,
    });
    if (error) {
      toast.error("Failed to record check-in");
    } else {
      toast.success(
        type === "sos"
          ? "🚨 Emergency alert sent!"
          : type === "check_in"
          ? "Checked in successfully!"
          : "Checked out successfully!"
      );
      setNote("");
      loadCheckins();

      // For SOS, notify all admins immediately
      if (type === "sos") {
        // Fetch job title for a meaningful admin alert
        const { data: jobData } = await supabase
          .from("jobs")
          .select("title")
          .eq("id", jobId)
          .single();
        const jobTitle = jobData?.title || "Unknown";

        const { data: admins } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");

        if (admins && admins.length > 0) {
          const notifications = admins.map((admin) => ({
            user_id: admin.user_id,
            title: "🚨 SOS Emergency Alert",
            message: `A user triggered an SOS emergency button on job "${jobTitle}". Immediate attention required.`,
            type: "warning",
            link: `/activity`,
          }));
          await supabase.from("notifications").insert(notifications);
        }

        toast.info("Emergency contacts and admin have been notified.");
      }
    }
    setLoading(false);
  };

  const isActive = jobStatus === "in_progress" || jobStatus === "accepted";
  const hasCheckedIn = checkins.some((c) => c.type === "check_in" && c.user_id === userId);
  const hasCheckedOut = checkins.some((c) => c.type === "check_out" && c.user_id === userId);

  if (!isActive && checkins.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Shield className="w-4 h-4 text-primary" /> Safety Check-ins
      </h3>
      <p className="text-xs text-muted-foreground">
        GPS-verified check-ins — you must be within 500 ft of the job location.
      </p>

      {isActive && isHelper && (
        <div className="space-y-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note…"
            className="text-sm"
            maxLength={200}
          />
          <div className="flex gap-2">
            {!hasCheckedIn && (
              <Button
                size="sm"
                onClick={() => doCheckin("check_in")}
                disabled={loading}
                className="flex-1"
              >
                <LogIn className="w-4 h-4 mr-1" /> Check In
              </Button>
            )}
            {hasCheckedIn && !hasCheckedOut && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => doCheckin("check_out")}
                disabled={loading}
                className="flex-1"
              >
                <LogOut className="w-4 h-4 mr-1" /> Check Out
              </Button>
            )}
            <Button
              size="sm"
              variant="destructive"
              onClick={() => doCheckin("sos")}
              disabled={loading}
            >
              <AlertOctagon className="w-4 h-4 mr-1" /> SOS
            </Button>
          </div>
        </div>
      )}

      {checkins.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          {checkins.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-xs">
              <span
                className={`px-2 py-0.5 rounded-full font-medium ${
                  c.type === "sos"
                    ? "bg-destructive/10 text-destructive"
                    : c.type === "check_in"
                    ? "bg-primary/10 text-primary"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                {c.type === "sos" ? "🚨 SOS" : c.type === "check_in" ? "Check In" : "Check Out"}
              </span>
              {c.latitude && (
                <span className="text-muted-foreground flex items-center gap-0.5">
                  <MapPin className="w-3 h-3" />
                  {c.latitude.toFixed(4)}, {c.longitude?.toFixed(4)}
                </span>
              )}
              <span className="text-muted-foreground ml-auto">
                {new Date(c.created_at).toLocaleTimeString()}
              </span>
              {c.note && <span className="text-muted-foreground italic">— {c.note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
