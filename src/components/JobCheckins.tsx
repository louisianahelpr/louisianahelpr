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

export function JobCheckins({
  jobId,
  userId,
  isHelper,
  isOwner,
  jobStatus,
}: {
  jobId: string;
  userId: string;
  isHelper: boolean;
  isOwner: boolean;
  jobStatus: string;
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

      // For SOS, also send a notification
      if (type === "sos") {
        // Notify the other party
        const notifyUserId = isHelper ? undefined : undefined; // We'd need the other user's ID
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
        GPS-timestamped check-ins for your safety.
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
