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

interface Props {
  helperId: string;
  /**
   * When true, render a "Not set yet" empty state for the owner to act on.
   * Default false (used on public user profiles where empty = just hide it).
   */
  showEmpty?: boolean;
  /** Called when the user taps the empty-state CTA. */
  onSetUp?: () => void;
}

export function HelperAvailabilityDisplay({ helperId, showEmpty = false, onSetUp }: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("helper_availability")
        .select("day_of_week, is_available, start_time, end_time")
        .eq("helper_id", helperId)
        .is("specific_date", null)
        .order("day_of_week");
      if (error) {
        console.error("[HelperAvailabilityDisplay] failed to load availability:", error);
      } else if (data && (data as unknown as Slot[]).length > 0) {
        setSlots(data as unknown as Slot[]);
      }
      setLoaded(true);
    })();
  }, [helperId]);

  if (!loaded) return null;

  const available = slots.filter((s) => s.is_available);
  const isEmpty = slots.length === 0 || available.length === 0;

  if (isEmpty && !showEmpty) return null;

  if (isEmpty) {
    return (
      <div className="rounded-ds-md liquid-glass p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-ds-13 font-semibold text-foreground">Availability not set</p>
            <p className="text-ds-11 text-muted-foreground truncate">
              Posters match jobs to your weekly hours.
            </p>
          </div>
        </div>
        {onSetUp && (
          <button
            type="button"
            onClick={onSetUp}
            className="shrink-0 text-ds-11 font-semibold text-primary hover:underline active:opacity-70"
          >
            Set Hours →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-ds-md liquid-glass p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary" />
        <h3 className="text-ds-13 font-semibold text-foreground">Availability</h3>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((day, i) => {
          const slot = slots.find((s) => s.day_of_week === i);
          const isAvail = slot?.is_available;
          return (
            <div key={day} className="text-center">
              <span className={`block text-ds-10 font-medium mb-1 ${isAvail ? "text-foreground" : "text-muted-foreground/40"}`}>
                {day}
              </span>
              <div className={`rounded-md py-1 text-ds-9 ${isAvail ? "bg-primary/10 text-primary font-medium" : "bg-muted text-muted-foreground/40"}`}>
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
