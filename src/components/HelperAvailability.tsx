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

export function HelperAvailability({ userId }: { userId: string }) {
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

  if (!loaded) return <p className="text-sm text-muted-foreground">Loading availability...</p>;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {DAYS.map((day, i) => {
          const slot = slots[i];
          return (
            <div
              key={day}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <Switch
                checked={slot.is_available}
                onCheckedChange={(checked) => updateSlot(i, "is_available", checked)}
              />
              <span className={`text-sm font-medium w-24 ${slot.is_available ? "text-foreground" : "text-muted-foreground line-through"}`}>
                {day.slice(0, 3)}
              </span>
              {slot.is_available && (
                <div className="flex items-center gap-2 text-sm">
                  <TimePickerSelect value={slot.start_time} onChange={(v) => updateSlot(i, "start_time", v)} />
                  <span className="text-muted-foreground">to</span>
                  <TimePickerSelect value={slot.end_time} onChange={(v) => updateSlot(i, "end_time", v)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? "Saving..." : "Save Availability"}
      </Button>
    </div>
  );
}
