import { useEffect, useState } from "react";
import { TimeRangeField } from "@/components/TimeRangeField";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type AvailabilitySlot = {
  id?: string;
  day_of_week: number;
  is_available: boolean;
  start_time: string;
  end_time: string;
};

type HelperAvailabilityRow = Database["public"]["Tables"]["helper_availability"]["Row"];
type HelperAvailabilityInsert = Database["public"]["Tables"]["helper_availability"]["Insert"];

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Failed to save";

export function HelperAvailability({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const [slots, setSlots] = useState<AvailabilitySlot[]>(
    DAYS.map((_, i) => ({ day_of_week: i, is_available: true, start_time: "09:00", end_time: "17:00" }))
  );
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadAvailability();
  }, [userId]);

  const loadAvailability = async () => {
    const { data } = await supabase
      .from("helper_availability")
      .select("*")
      .eq("helper_id", userId)
      .is("specific_date", null)
      .order("day_of_week");

    if (data && data.length > 0) {
      const existingSlots = DAYS.map((_, i) => {
        const existing = data.find((slot: HelperAvailabilityRow) => slot.day_of_week === i);
        if (existing) {
          return {
            id: existing.id,
            day_of_week: i,
            is_available: existing.is_available ?? true,
            start_time: existing.start_time || "09:00",
            end_time: existing.end_time || "17:00",
          };
        }
        return { day_of_week: i, is_available: true, start_time: "09:00", end_time: "17:00" };
      });
      setSlots(existingSlots);
    }
    setLoaded(true);
  };

  const updateSlot = <K extends "is_available" | "start_time" | "end_time">(
    dayIndex: number,
    field: K,
    value: AvailabilitySlot[K]
  ) => {
    setSlots((prev) =>
      prev.map((s) => (s.day_of_week === dayIndex ? { ...s, [field]: value } : s))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Delete existing weekly slots
      await supabase
        .from("helper_availability")
        .delete()
        .eq("helper_id", userId)
        .is("specific_date", null);

      // Insert new slots
      const inserts: HelperAvailabilityInsert[] = slots.map((s) => ({
        helper_id: userId,
        day_of_week: s.day_of_week,
        is_available: s.is_available,
        start_time: s.start_time,
        end_time: s.end_time,
        specific_date: null,
      }));

      const { error } = await supabase.from("helper_availability").insert(inserts);
      if (error) throw error;
      toast.success("Availability saved!");
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <p className="text-sm text-muted-foreground p-3">Loading availability...</p>;

  if (compact) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 min-h-0 overflow-hidden p-2 space-y-1.5">
          {DAYS.map((day, i) => {
            const slot = slots[i];
            const off = !slot.is_available;
            return (
              <div
                key={day}
                className={cn(
                  "rounded-lg border px-2 py-1.5 transition-all",
                  off ? "border-border/60 bg-muted/30" : "border-border bg-card shadow-sm",
                )}
              >
                <div className="flex items-center justify-between gap-1.5 min-h-10">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Switch
                      checked={slot.is_available}
                      onCheckedChange={(checked) => updateSlot(i, "is_available", checked)}
                      aria-label={`Toggle ${day}`}
                    />
                    <span
                      className={cn(
                        "font-display text-[13px] font-bold w-8",
                        off ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {day.slice(0, 3)}
                    </span>
                  </div>

                  {slot.is_available ? (
                    <TimeRangeField
                      start={slot.start_time}
                      end={slot.end_time}
                      onChange={({ start, end }) => {
                        updateSlot(i, "start_time", start);
                        updateSlot(i, "end_time", end);
                      }}
                      className="h-9 px-2.5 rounded-lg text-xs gap-1.5"
                    />
                  ) : (
                    <span className="text-xs font-medium text-muted-foreground">Unavailable</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border p-2 bg-card/80 backdrop-blur shrink-0">
          <Button
            onClick={handleSave}
            disabled={saving}
            size="lg"
            className="w-full h-10 rounded-lg text-sm font-semibold"
          >
            {saving ? "Saving..." : "Save Availability"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {DAYS.map((day, i) => {
          const slot = slots[i];
          const off = !slot.is_available;
          return (
            <div
              key={day}
              className={cn(
                "rounded-2xl border p-4 transition-all",
                off
                  ? "border-border/60 bg-muted/30"
                  : "border-border bg-card shadow-sm",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Switch
                    checked={slot.is_available}
                    onCheckedChange={(checked) => updateSlot(i, "is_available", checked)}
                    aria-label={`Toggle ${day}`}
                  />
                  <span
                    className={cn(
                      "font-display text-[15px] font-bold tracking-tight w-10",
                      off ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {day.slice(0, 3)}
                  </span>
                </div>

                {slot.is_available ? (
                  <TimeRangeField
                    start={slot.start_time}
                    end={slot.end_time}
                    onChange={({ start, end }) => {
                      updateSlot(i, "start_time", start);
                      updateSlot(i, "end_time", end);
                    }}
                  />
                ) : (
                  <span className="text-sm font-medium text-muted-foreground">Unavailable</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Button
        onClick={handleSave}
        disabled={saving}
        size="lg"
        className="w-full h-12 rounded-2xl text-[15px] font-semibold"
      >
        {saving ? "Saving..." : "Save Availability"}
      </Button>
    </div>
  );
}
