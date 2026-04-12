import { useEffect, useState } from "react";
import { TimePickerSelect } from "@/components/TimePickerSelect";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type AvailabilitySlot = {
  id?: string;
  day_of_week: number;
  is_available: boolean;
  start_time: string;
  end_time: string;
};

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
      .from("helper_availability" as any)
      .select("*")
      .eq("helper_id", userId)
      .is("specific_date", null)
      .order("day_of_week");

    if (data && (data as any[]).length > 0) {
      const existingSlots = DAYS.map((_, i) => {
        const existing = (data as any[]).find((d: any) => d.day_of_week === i);
        if (existing) {
          return {
            id: existing.id,
            day_of_week: i,
            is_available: existing.is_available,
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

  const updateSlot = (dayIndex: number, field: keyof AvailabilitySlot, value: any) => {
    setSlots((prev) =>
      prev.map((s) => (s.day_of_week === dayIndex ? { ...s, [field]: value } : s))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Delete existing weekly slots
      await (supabase.from("helper_availability" as any) as any)
        .delete()
        .eq("helper_id", userId)
        .is("specific_date", null);

      // Insert new slots
      const inserts = slots.map((s) => ({
        helper_id: userId,
        day_of_week: s.day_of_week,
        is_available: s.is_available,
        start_time: s.start_time,
        end_time: s.end_time,
        specific_date: null,
      }));

      const { error } = await (supabase.from("helper_availability" as any) as any).insert(inserts);
      if (error) throw error;
      toast.success("Availability saved!");
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
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
