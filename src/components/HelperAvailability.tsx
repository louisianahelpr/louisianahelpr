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
      const inserts: HelperAvailabilityInsert[] = slots.map((s) => ({
        helper_id: userId,
        day_of_week: s.day_of_week,
        is_available: s.is_available,
        start_time: s.start_time,
        end_time: s.end_time,
        specific_date: null,
      }));

      // ONE transaction. This used to be a DELETE then a separate INSERT from
      // here, so leaving the page, losing the network or a refused insert
      // between the two calls wiped the whole week, and the grid then showed
      // a default 9-5 that was never saved (journeys audit, 2026-09-12).
      // save_weekly_availability deletes and inserts atomically under the same
      // RLS policy. The legacy two-step path below runs ONLY while that
      // function is not deployed yet (PGRST202), per CLAUDE.md.
      const { data: savedCount, error: rpcError } = await supabase.rpc(
        "save_weekly_availability" as never,
        { p_slots: inserts.map(({ helper_id: _h, specific_date: _d, ...slot }) => slot) } as never,
      );
      if (rpcError && (rpcError as { code?: string }).code !== "PGRST202") throw rpcError;
      if (rpcError) {
        unwrapMutation(
          await supabase
            .from("helper_availability")
            .delete()
            .eq("helper_id", userId)
            .is("specific_date", null)
            .select("id"),
          { action: "update your weekly hours", min: 0, context: { helperId: userId } },
        );
        unwrapMutation(
          await supabase.from("helper_availability").insert(inserts).select("id"),
          { action: "save your weekly hours", min: inserts.length, context: { helperId: userId } },
        );
      } else if (Number(savedCount) !== inserts.length) {
        throw new Error("Only part of your week was saved. Please try again.");
      }
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
                        "font-sans text-ds-13 font-bold w-8",
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
          set every day individually. They WRAP. This row used to be a
          hidden-scrollbar horizontal scroller, which at 375 clipped the
          second pill to "Weekends o" and hid the third entirely, with nothing
          on screen saying the row moves — a chopped word reads as a rendering
          fault, not an affordance. Three short pills on two lines costs one
          extra row of height and hides nothing. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0 text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">
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
              {/* Row budget at 375: the card's inner width is 235px, the
                  switch+label cluster takes 95, and the hours pill gets what
                  is left. With gap-3 on both flex rows that left 82px for
                  text that measures 89px, so the DEFAULT "9 AM – 5 PM"
                  rendered "9 AM – 5 …" on every row — a comment in
                  TimeRangeField said the compact format fixed exactly this,
                  and it did not. gap-2 on both rows buys 8px; `flex-wrap`
                  is the safety net so a wide range ("10:30 AM – 5:30 PM")
                  drops to its own line instead of ever being cut off. Label
                  column is w-9: the widest three-letter day measures 34px. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Switch
                    checked={slot.is_available}
                    onCheckedChange={(checked) => updateSlot(i, "is_available", checked)}
                    aria-label={`Toggle ${day}`}
                  />
                  <span
                    className="font-sans font-bold w-9 text-ds-15"
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
                    className="ml-auto px-2.5 gap-1"
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
