import { useEffect, useState } from "react";
import { toast } from "sonner";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { hapticLight } from "@/lib/haptics";
import { formatPrice, formatPriceExact } from "@/lib/format";

type Mode = "off" | "percent" | "fixed";

const PERCENT_PRESETS = [10, 15, 20];
const FIXED_PRESETS = [5, 10, 20];
/** Mirrors the CHECK constraint in 20260811180000. Kept in sync deliberately:
 *  the form should refuse a bad value before the database has to. */
const LIMITS = { percent: { min: 1, max: 50 }, fixed: { min: 1, max: 500 }, cap: { min: 1, max: 500 } };

/**
 * Auto-tip settings.
 *
 * A standing preference to tip after a job completes — Lyft's model. It is
 * NOT bundled into the job's original charge: Helpr captures the job in full
 * at checkout, so a bundled tip would have to be REFUNDED whenever the poster
 * adjusted it down, and Stripe keeps the processing fee on refunds. A separate
 * post-completion charge costs less overall and only ever charges for work
 * that actually happened.
 */
const AutoTip = () => {
  usePageTitle("Auto-tip — Helpr");
  const { user, profile, refresh } = useCurrentUser();

  const [mode, setMode] = useState<Mode>("off");
  const [value, setValue] = useState<string>("15");
  const [cap, setCap] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Seed from the profile once it arrives. Guarded by `loaded` so a later
  // profile refetch can't stomp edits the user is in the middle of making.
  useEffect(() => {
    if (!profile || loaded) return;
    const p = profile as unknown as {
      auto_tip_mode?: Mode | null;
      auto_tip_value?: number | null;
      auto_tip_cap?: number | null;
    };
    setMode(p.auto_tip_mode ?? "off");
    if (p.auto_tip_value != null) setValue(String(p.auto_tip_value));
    if (p.auto_tip_cap != null) setCap(String(p.auto_tip_cap));
    setLoaded(true);
  }, [profile, loaded]);

  const numericValue = Number(value);
  const numericCap = cap.trim() ? Number(cap) : null;
  const limits = mode === "percent" ? LIMITS.percent : LIMITS.fixed;
  const valueValid =
    mode === "off" ||
    (Number.isFinite(numericValue) && numericValue >= limits.min && numericValue <= limits.max);
  const capValid =
    mode !== "percent" ||
    numericCap === null ||
    (Number.isFinite(numericCap) && numericCap >= LIMITS.cap.min && numericCap <= LIMITS.cap.max);

  const save = async () => {
    // Never return silently. The button is disabled while any of these hold,
    // so reaching here means something is out of sync between the disabled
    // state and the guard — say so rather than swallowing the tap, which is
    // indistinguishable from a dead button ("when I click save nothing
    // happens like it didn't work").
    if (!user?.id) {
      toast.error("You're signed out — sign in again to change this.");
      return;
    }
    if (!valueValid || !capValid) {
      toast.error("Check the highlighted amount before saving.");
      return;
    }
    setSaving(true);
    // `.select()` is load-bearing, not decoration. A bare
    // `.update().eq(...)` resolves with `{ data: null, error: null }` whether
    // it changed one row or NONE — so an update that RLS filters out, or one
    // whose `user_id` matches nothing, is indistinguishable from success. The
    // screen then toasted "Auto-tip saved" over a write that never landed, and
    // the setting was simply gone on the next visit. Asking for the changed
    // rows back is the only way to know.
    const { data: updated, error } = await supabase
      .from("profiles")
      .update({
        auto_tip_mode: mode,
        // Null when off, so the row can never carry a stale amount behind a
        // disabled preference — the CHECK constraint enforces this too.
        auto_tip_value: mode === "off" ? null : numericValue,
        auto_tip_cap: mode === "percent" ? numericCap : null,
      })
      .eq("user_id", user.id)
      .select("user_id");
    setSaving(false);
    if (error) {
      report(error, { tags: { source: "AutoTip.save" } });
      toast.error("Couldn't save your auto-tip.", { description: error.message });
      return;
    }
    if (!updated || updated.length === 0) {
      report(new Error("AutoTip update matched no rows"), {
        tags: { source: "AutoTip.save" },
        context: { user_id: user.id, mode },
      });
      toast.error("Couldn't save your auto-tip.", {
        description: "We couldn't reach your profile. Try again in a moment.",
      });
      return;
    }
    // Pull the profile back through so the value the page re-seeds from next
    // time is the value that actually persisted, not the local state that
    // happened to be on screen. The realtime `profiles` subscription in
    // useCurrentUser usually invalidates this already, but it is best-effort
    // (and drops on a cold native socket) — this makes the read-back certain.
    void refresh();
    void hapticLight();
    toast.success(mode === "off" ? "Auto-tip turned off" : "Auto-tip saved");
  };

  // A worked example beats a description. $150 is close to the median job.
  const uncapped = mode === "percent" && valueValid ? (150 * numericValue) / 100 : null;
  const example =
    uncapped != null
      ? Math.min(Math.round(uncapped), numericCap ?? Infinity)
      : mode === "fixed" && valueValid
        ? numericValue
        : null;
  // When the maximum is what produced the figure, SAY so. Without this the
  // sentence reads like broken arithmetic: 15% of $150 is $22.50, not $15,
  // and a money screen that appears to miscalculate is a trust problem.
  const cappedByMax = uncapped != null && example != null && example < Math.round(uncapped);

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader title="Auto-Tip" />
            {/* CANONICAL DOCUMENT-SCROLL SHELL — identical on every page that wears
          it: `min-h-screen bg-premium-page pb-safe-nav` > <PageHeader> (default
          width) > `page-measure mx-auto px-5 lg:px-8 xl:px-12 pt-4 pb-8`.
          The header's `default` width IS this body class, so the title and the
          content share one left edge at every breakpoint. Owner: these pages
          "should share layouts ... there should not be any off from the rest",
          so do not give this page its own max-width or gutter ladder. */}
      <div className="page-measure mx-auto px-5 lg:px-8 xl:px-12 pt-4 pb-8 space-y-5">
        <section className="liquid-glass rounded-ds-md p-5 space-y-4">
          <p
            className="font-serif italic text-ds-13 leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            Tip automatically once a job is finished, without having to remember.
            Charged after completion — never before — so you only ever tip for
            work that actually happened, and the whole tip goes to your Helpr:
            Helpr takes no cut, only the card processing fee applies. If you
            haven't saved a card, we'll ask you to confirm the tip instead of
            charging it automatically.
          </p>

          <div className="grid grid-cols-3 gap-2">
            {(["off", "percent", "fixed"] as const).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={active}
                  onClick={() => { void hapticLight(); setMode(m); }}
                  className="py-2.5 rounded-ds-md text-ds-12 font-sans font-semibold transition-colors"
                  style={{
                    background: active ? "hsl(var(--bark) / 0.15)" : "transparent",
                    border: `1px solid hsl(var(--bark) / ${active ? "0.40" : "0.18"})`,
                    color: "hsl(var(--bark))",
                  }}
                >
                  {m === "off" ? "Off" : m === "percent" ? "Percentage" : "Fixed"}
                </button>
              );
            })}
          </div>

          {mode !== "off" && (
            <div className="space-y-2">
              <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                {mode === "percent" ? "Percent of the job" : "Amount per job"}
              </p>
              <div className="flex gap-2 flex-wrap">
                {(mode === "percent" ? PERCENT_PRESETS : FIXED_PRESETS).map((n) => {
                  const active = String(n) === value;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setValue(String(n))}
                      className="flex-1 py-2 rounded-ds-sm text-ds-13 font-sans font-semibold transition-colors"
                      style={{
                        background: active ? "hsl(var(--bark) / 0.15)" : "transparent",
                        border: `1px solid hsl(var(--bark) / ${active ? "0.40" : "0.18"})`,
                        color: "hsl(var(--bark))",
                      }}
                    >
                      {mode === "percent" ? `${n}%` : `$${n}`}
                    </button>
                  );
                })}
                <input
                  type="number"
                  aria-label={mode === "percent" ? "Custom percentage" : "Custom amount in dollars"}
                  min={limits.min}
                  max={limits.max}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="flex-1 py-2 px-3 rounded-ds-sm text-ds-13 font-sans font-semibold text-center"
                  style={{
                    background: "transparent",
                    border: `1px solid hsl(var(--${valueValid ? "bark" : "burnt-sienna"}) / 0.40)`,
                    color: "hsl(var(--bark))",
                    outline: "none",
                    minWidth: 0,
                  }}
                />
              </div>
              {!valueValid && (
                <p className="font-serif italic text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
                  {mode === "percent" ? "Pick between 1% and 50%." : `Pick between $${LIMITS.fixed.min} and $${LIMITS.fixed.max}.`}
                </p>
              )}
            </div>
          )}

          {mode === "percent" && (
            <div className="space-y-2">
              <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Maximum per job — optional
              </p>
              <input
                type="number"
                aria-label="Maximum tip per job in dollars"
                min={LIMITS.cap.min}
                max={LIMITS.cap.max}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                className="w-full py-2 px-3 rounded-ds-sm text-ds-13 font-sans font-semibold"
                style={{
                  background: "transparent",
                  border: `1px solid hsl(var(--${capValid ? "bark" : "burnt-sienna"}) / 0.40)`,
                  color: "hsl(var(--bark))",
                  outline: "none",
                }}
              />
              {/* The cap is the whole reason percentage mode is safe to offer:
                  15% of a $600 job is $90, which is not what most people
                  picture when they set "15%". */}
              <p className="font-serif italic text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                A percentage of a large job adds up. A maximum keeps it predictable.
              </p>
            </div>
          )}

          {example != null && (
            <div
              className="rounded-ds-md p-3"
              style={{ background: "hsl(var(--bark) / 0.06)", border: "0.5px solid hsl(var(--bark) / 0.18)" }}
            >
              <p className="text-ds-12 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>
                On a <span className="font-semibold">$150</span> job you'd tip{" "}
                <span className="font-semibold">${formatPrice(example)}</span>
                {cappedByMax ? (
                  <> — {numericValue}% would be ${formatPriceExact(uncapped!)}, held to your ${formatPrice(numericCap!)} maximum.</>
                ) : (
                  "."
                )}
              </p>
            </div>
          )}

          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={saving || !valueValid || !capValid}
            className="w-full rounded-ds-md"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </section>
        {/* A trailing explainer card used to sit here. Removed on owner
            instruction: it was a second explanation of the same feature at the
            far end of a short screen, after the Save button had already ended
            it. Its one piece of load-bearing behaviour — that an unsaved card
            means we confirm the tip rather than auto-charge it — was folded
            into the opening paragraph rather than lost. */}
      </div>
    </div>
  );
};

export default AutoTip;
