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
import { userFacingError } from "@/lib/userFacingError";

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
  userFacingError(error, "Couldn't save that — try again?");

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
  //
  // Each preset is a pure function of the week, so the row can tell when one
  // would change NOTHING and disable it (Q34): on the default week (every day
  // 09:00-17:00) "Copy Mon to all" was a live button whose press did nothing
  // at all, which the press sweep rightly flagged as a silent no-op.
  const weekdays9to5 = (prev: AvailabilitySlot[]) =>
    prev.map((s) => {
      const isWeekday = s.day_of_week >= 1 && s.day_of_week <= 5;
      return {
        ...s,
        is_available: isWeekday,
        start_time: isWeekday ? "09:00" : s.start_time,
        end_time: isWeekday ? "17:00" : s.end_time,
      };
    });
  const weekendsOff = (prev: AvailabilitySlot[]) =>
    prev.map((s) =>
      s.day_of_week === 0 || s.day_of_week === 6 ? { ...s, is_available: false } : s,
    );
  const mondayToAll = (prev: AvailabilitySlot[]) => {
    const monday = prev.find((s) => s.day_of_week === 1);
    if (!monday) return prev;
    return prev.map((s) => ({
      ...s,
      is_available: monday.is_available,
      start_time: monday.start_time,
      end_time: monday.end_time,
    }));
  };
  const changesWeek = (preset: (prev: AvailabilitySlot[]) => AvailabilitySlot[]) =>
    preset(slots).some(
      (s, i) =>
        s.is_available !== slots[i].is_available ||
        s.start_time !== slots[i].start_time ||
        s.end_time !== slots[i].end_time,
    );

  const handleSave = async () => {
    // ST-002: an end before its start (9 PM to 5 PM) showed the day as
    // available while the browse filter could match no job on it. The DB
    // refuses it too (helper_availability_range_forward).
    const inverted = slots.find((s) => s.is_available && s.start_time.slice(0, 5) >= s.end_time.slice(0, 5));
    if (inverted) {
      toast.error(`${DAYS[inverted.day_of_week]}: the end time has to be after the start time.`);
      return;
    }
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
        "save_weekly_availability",
        { p_slots: inserts.map(({ helper_id: _h, specific_date: _d, ...slot }) => slot) },
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
            {saving ? "Saving..." : "Save availability"}
          </Button>
        </div>
      </div>
    );
  }

  // Spec v2 rebuild (audit 2026-10-21): ONE compact list. Seven day rows in a
  // single card, split by hairlines, instead of seven stacked cards; the
  // presets are the shared chip; "Day off" is quiet text, not an uppercase pill.
  // The off row is dimmed through its label colour, never opacity (an 85%
  // container compounded with its own text and failed AA, 12 axe nodes).
  return (
    <div className="space-y-3">
      <h2 className="text-ds-12 font-sans font-semibold uppercase tracking-[0.08em] text-muted-foreground px-1">
        Your weekly hours
      </h2>
      {/* The presets WRAP (a hidden-scrollbar scroller clipped "Weekends o"
          at 375 and hid the third pill). */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { label: "Weekdays 9–5", apply: weekdays9to5 },
          { label: "Weekends off", apply: weekendsOff },
          { label: "Copy Mon to all", apply: mondayToAll },
        ].map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => setSlots(preset.apply)}
            disabled={!changesWeek(preset.apply)}
            className="shrink-0 inline-flex items-center rounded-full px-3.5 min-h-9 text-ds-13 font-sans font-semibold text-foreground border active:scale-[0.96] transition-all disabled:opacity-50 disabled:active:scale-100"
            style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="rounded-[20px] liquid-glass px-4 divide-y divide-[hsl(var(--sand))]" data-availability-list="">
        {DAYS.map((day, i) => {
          const slot = slots[i];
          const off = !slot.is_available;
          return (
            // Row budget at 375: switch + label take ~95px; gap-2 and
            // `flex-wrap` keep a wide range ("10:30 AM – 5:30 PM") on its own
            // line rather than ever cutting it off.
            <div key={day} className="flex flex-wrap items-center justify-between gap-2 py-2.5 min-h-[56px]">
              <div className="flex items-center gap-2.5 min-w-0">
                <Switch
                  checked={slot.is_available}
                  onCheckedChange={(checked) => updateSlot(i, "is_available", checked)}
                  aria-label={`Toggle ${day}`}
                />
                <span
                  className="font-sans font-bold w-9 text-ds-15"
                  style={{ color: off ? "hsl(var(--muted-foreground))" : "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
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
                <span className="ml-auto text-ds-13 font-sans text-muted-foreground">Day off</span>
              )}
            </div>
          );
        })}
      </div>
      <Button
        onClick={handleSave}
        disabled={saving}
        size="lg"
        className="w-full h-12 rounded-full text-ds-15 font-semibold"
      >
        {saving ? "Saving…" : "Save availability"}
      </Button>
    </div>
  );
}
