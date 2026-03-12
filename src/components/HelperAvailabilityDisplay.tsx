import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Clock } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Slot = { day_of_week: number; is_available: boolean; start_time: string; end_time: string };

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${suffix}`;
}

export function HelperAvailabilityDisplay({ helperId }: { helperId: string }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("helper_availability" as any)
        .select("day_of_week, is_available, start_time, end_time")
        .eq("helper_id", helperId)
        .is("specific_date", null)
        .order("day_of_week");
      if (data && (data as unknown as Slot[]).length > 0) setSlots(data as unknown as Slot[]);
      setLoaded(true);
    })();
  }, [helperId]);

  if (!loaded || slots.length === 0) return null;

  const available = slots.filter((s) => s.is_available);
  if (available.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Availability</h3>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((day, i) => {
          const slot = slots.find((s) => s.day_of_week === i);
          const isAvail = slot?.is_available;
          return (
            <div key={day} className="text-center">
              <span className={`block text-[10px] font-medium mb-1 ${isAvail ? "text-foreground" : "text-muted-foreground/40"}`}>
                {day}
              </span>
              <div className={`rounded-md py-1 text-[9px] ${isAvail ? "bg-primary/10 text-primary font-medium" : "bg-muted text-muted-foreground/40"}`}>
                {isAvail && slot ? (
                  <>
                    {formatTime(slot.start_time).replace(" ", "\u00A0")}
                    <br />
                    {formatTime(slot.end_time).replace(" ", "\u00A0")}
                  </>
                ) : (
                  "Off"
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
