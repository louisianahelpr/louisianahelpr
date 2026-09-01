import { useEffect, useState } from "react";
import { TimeRangeField } from "@/components/TimeRangeField";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { ErrorState } from "@/components/ui/ErrorState";
import { report } from "@/lib/errorLogger";
import { unwrapMutation, isWriteRejected, mutationErrorMessage } from "@/lib/mutationResult";
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
  error instanceof Error ? error.message : "Couldn't save that — try again?";

export function HelperAvailability({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const [slots, setSlots] = useState<AvailabilitySlot[]>(
    DAYS.map((_, i) => ({ day_of_week: i, is_available: true, start_time: "09:00", end_time: "17:00" }))
  );
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // A failed LOAD must not fall through to the editable grid. `slots` is
  // seeded above with a fabricated "available every day, 9–5" week purely as
  // a starting shape; when the fetch fails the helper was shown that week as
  // if it were theirs, and one tap on Save overwrote their real hours with it.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    loadAvailability();
  }, [userId]);

  const loadAvailability = async () => {
    const { data, error } = await supabase
      .from("helper_availability")
      .select("*")
      .eq("helper_id", userId)
      .is("specific_date", null)
      .order("day_of_week");

    if (error) {
      console.error("[HelperAvailability] failed to load availability:", error);
      report(error, {
        severity: "error",
        tags: { source: "HelperAvailability.load" },
        context: { helperId: userId },
      });
      toast.error("Couldn't load your availability — try again?");
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setLoadFailed(false);

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

  // Bulk shortcuts — saves users from setting each day individually.
  // "Weekdays 9–5" is the most common helper schedule; "Weekends off"
  // is one tap for that adjustment; "Copy Mon to all" repeats whatever
  // window the user already set for Monday across every other day.
  const applyWeekdays9to5 = () => {
    setSlots((prev) =>
      prev.map((s) => {
        const isWeekday = s.day_of_week >= 1 && s.day_of_week <= 5;
        return {
          ...s,
          is_available: isWeekday,
          start_time: isWeekday ? "09:00" : s.start_time,
          end_time: isWeekday ? "17:00" : s.end_time,
        };
      }),
    );
  };
  const applyWeekendsOff = () => {
    setSlots((prev) =>
      prev.map((s) =>
        s.day_of_week === 0 || s.day_of_week === 6 ? { ...s, is_available: false } : s,
      ),
    );
  };
  const copyMondayToAll = () => {
    const monday = slots.find((s) => s.day_of_week === 1);
    if (!monday) return;
    setSlots((prev) =>
      prev.map((s) => ({
        ...s,
        is_available: monday.is_available,
        start_time: monday.start_time,
        end_time: monday.end_time,
      })),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Clear the existing weekly slots. The result used to be DISCARDED
      // entirely — no await destructure, no `error` check, no `.select()`.
      // That is the worst shape this codebase has: if the delete were refused
      // (RLS, a stale session) the insert below still ran, so every tap of
      // Save added another 7 rows. `loadAvailability` does `data.find(...)`,
      // which returns the first match, so the duplicates were invisible on
      // THIS screen while `useDashboardData` and `HelperAvailabilityDisplay`
      // read the same table. `min: 0` because a helper who has never saved
      // legitimately has nothing to delete — the assertion here is that the
      // statement was ACCEPTED, not that it matched rows.
      unwrapMutation(
        await supabase
          .from("helper_availability")
          .delete()
          .eq("helper_id", userId)
          .is("specific_date", null)
          .select("id"),
        { action: "update your weekly hours", min: 0, context: { helperId: userId } },
      );

      // Insert new slots
      const inserts: HelperAvailabilityInsert[] = slots.map((s) => ({
        helper_id: userId,
        day_of_week: s.day_of_week,
        is_available: s.is_available,
        start_time: s.start_time,
        end_time: s.end_time,
        specific_date: null,
      }));

      // Guarded for the same reason: an insert silently filtered by RLS
      // returns `{ data: [], error: null }`, and the old code fired
      // hapticSuccess() on it. `min: inserts.length` — a partial insert means
      // the week is now half-written, which the helper must be told about.
      unwrapMutation(
        await supabase.from("helper_availability").insert(inserts).select("id"),
        { action: "save your weekly hours", min: inserts.length, context: { helperId: userId } },
      );
      hapticSuccess();
      // The screen cannot answer "did that work?" on its own: the grid already
      // showed the typed state before the save, so a successful save leaves
      // the page byte-identical. `toast.success` would be swallowed by
      // toastPolicy (non-actionable confirmations are no-ops app-wide), so
      // this uses the BARE callable, which the policy deliberately lets
      // through. Without it the only feedback was a haptic — a no-op on web.
      toast("Weekly hours saved");
    } catch (err: unknown) {
      hapticError();
      toast.error(
        isWriteRejected(err) ? mutationErrorMessage(err, getErrorMessage(err)) : getErrorMessage(err),
      );
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <p className="text-ds-11 text-muted-foreground p-3">Loading availability...</p>;

  // See `loadFailed` above — never hand back the fabricated default week as if
  // it were the helper's saved schedule.
  if (loadFailed) {
    return (
      <ErrorState
        title="We couldn't load your hours."
        body="Your saved schedule is still safe — we just couldn't read it right now."
        onRetry={() => {
          setLoaded(false);
          setLoadFailed(false);
          void loadAvailability();
        }}
      />
    );
  }

  if (compact) {
    return (
      <div className="h-full flex flex-col min-h-0">
        <div
          data-allow-scroll="true"
          className="flex-1 min-h-0 overflow-hidden p-2 space-y-1"
        >
          {DAYS.map((day, i) => {
            const slot = slots[i];
            const off = !slot.is_available;
            return (
              <div
                key={day}
                className={cn(
                  "rounded-ds-sm border px-2 py-1 transition-all",
                  off ? "border-border/60 bg-muted/30" : "border-border bg-card shadow-sm",
                )}
              >
                <div className="flex items-center justify-between gap-1.5 min-h-9">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Switch
                      checked={slot.is_available}
                      onCheckedChange={(checked) => updateSlot(i, "is_available", checked)}
                      aria-label={`Toggle ${day}`}
                    />
                    <span
                      className={cn(
                        "font-display text-ds-13 font-bold w-8",
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
                      className="h-8 px-2 rounded-ds-sm text-ds-11 gap-1.5"
                    />
                  ) : (
                    <span className="text-ds-11 font-medium text-muted-foreground">Unavailable</span>
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
            className="w-full h-9 rounded-ds-sm text-ds-13 font-semibold"
          >
            {saving ? "Saving..." : "Save Availability"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bulk shortcuts — three one-tap presets so users don't have to
          set every day individually. Horizontal scroll on narrow phones
          so the pills never wrap awkwardly. */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1">
        <span
          className="shrink-0 font-serif italic uppercase text-ds-10"
          style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
        >
          Quick set:
        </span>
        {[
          { label: "Weekdays 9–5", onClick: applyWeekdays9to5 },
          { label: "Weekends off", onClick: applyWeekendsOff },
          { label: "Copy Mon to all", onClick: copyMondayToAll },
        ].map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={preset.onClick}
            className="shrink-0 inline-flex items-center rounded-full px-3 h-7 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-all"
            style={{
              background: "var(--surface-premium)",
              border: "1px solid hsl(var(--olivewood) / 0.18)",
              color: "hsl(var(--olivewood))",
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {DAYS.map((day, i) => {
          const slot = slots[i];
          const off = !slot.is_available;
          return (
            <div
              key={day}
              className={cn(
                "rounded-2xl liquid-glass p-4 transition-all",
                // Dimming an "off" row with opacity attenuates its TEXT too:
                // at 70% the day label and hours measured under the 4.5:1 AA
                // bar (12 axe nodes). 85% still reads as de-emphasised without
                // pushing the copy below the threshold.
                off && "opacity-85",
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
                    className="font-display italic font-bold w-10 text-ds-16"
                    style={{
                      color: off ? "hsl(var(--olivewood) / 0.8)" : "hsl(var(--ink-deep))",
                      letterSpacing: "-0.01em",
                    }}
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
                  /* "Day off" pill — explicit chip rather than fading
                      italic text so the off state reads as intentional,
                      not forgotten. */
                  <span
                    className="inline-flex items-center rounded-full px-2.5 py-0.5 text-ds-11 font-sans font-semibold uppercase tracking-wider"
                    style={{
                      background: "hsl(var(--olivewood) / 0.10)",
                      // Full strength, not 0.8: this pill sits inside the
                      // dimmed "off" card, so its own alpha compounded with the
                      // container's and landed at 4.15:1 — still under AA even
                      // after the container was lifted to 85%.
                      color: "hsl(var(--olivewood))",
                      border: "1px solid hsl(var(--olivewood) / 0.18)",
                    }}
                  >
                    Day off
                  </span>
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
        className="w-full h-12 rounded-2xl text-ds-15 font-semibold"
      >
        {saving ? "Saving…" : "Save Availability"}
      </Button>
    </div>
  );
}
