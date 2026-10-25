import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ChoicePill } from "@/components/ui/ChoicePill";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { hapticLight } from "@/lib/haptics";
import { formatPrice, formatPriceExact } from "@/lib/format";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { centsLabel, tipQuoteForDollars } from "@/components/TipCostBreakdown";

type Mode = "off" | "percent" | "fixed";

/** Board 182's default-tip pills. A saved value that is none of these shows
 *  as "Other" with its own field, so nothing a poster set before is lost. */
const CHIPS = [
  { mode: "percent", value: 10, label: "10%" },
  { mode: "percent", value: 15, label: "15%" },
  { mode: "percent", value: 20, label: "20%" },
  { mode: "fixed", value: 5, label: "$5 flat" },
] as const;
/** Mirrors the CHECK constraint in 20260811180000. Kept in sync deliberately:
 *  the form should refuse a bad value before the database has to. */
// Fixed amounts and caps start at the $3 tip minimum (TIP_MIN_CENTS); a
// percent tip that works out under it is not charged and the poster is asked.
const LIMITS = { percent: { min: 1, max: 50 }, fixed: { min: 3, max: 500 }, cap: { min: 3, max: 500 } };

const UNIT_MARK =
  "absolute top-1/2 -translate-y-1/2 text-ds-13 font-sans font-semibold pointer-events-none text-muted-foreground";

/** A number field is 36.8px tall on its own line (measured on the maximum-per-job
 *  input at every breakpoint) — under the 44px minimum. `min-h-[44px]` is the fix;
 *  inputs are not covered by the global touch-target rule. */
const FIELD_BASE =
  "w-full min-h-[44px] py-2 rounded-ds-sm text-ds-13 font-sans font-semibold bg-card text-foreground";
const fieldStyle = (valid: boolean) => ({
  border: `1px solid hsl(var(--${valid ? "border" : "burnt-sienna"})${valid ? "" : " / 0.6"})`,
  outline: "none",
});

/**
 * "After a Job" — everything that happens automatically once a job is finished.
 *
 * TWO settings, one question. The screen was called "Auto-Tip" while carrying
 * the Instant Release toggle as well (owner, 2026-08-31: "title is auto tip but
 * it's also auto release"), so the title named half its own contents. Renamed
 * to cover both rather than split them: they answer the same question — what
 * should happen by itself when the work is done — and a poster setting one is
 * exactly the poster who wants to consider the other. Each now carries its own
 * `h2` beneath the page title, so the screen reads as two named sections rather
 * than one settings page with a stray toggle at the bottom.
 *
 * The tip is a standing preference charged AFTER completion — Lyft's model. It
 * is NOT bundled into the job's original charge: Helpr captures the job in full
 * at checkout, so a bundled tip would have to be REFUNDED whenever the poster
 * adjusted it down, and Stripe keeps the processing fee on refunds. A separate
 * post-completion charge costs less overall and only ever charges for work that
 * actually happened.
 *
 * A Profile tab, not a route. Was the standalone `/auto-tip` until 2026-09-02,
 * reached only from Profile's own chrome. It renders the canonical tab body —
 * <ProfileTabBody> under a ProfileTabHeader — and NOT AppPage: AppPage is AppShell
 * + that header, and Profile.tsx already owns the AppShell, so keeping it here
 * would nest two 100dvh viewport locks.
 */
const AutoTip = ({ onBack }: { onBack?: () => void }) => {
  const { user, profile, refresh } = useCurrentUser();

  const [mode, setMode] = useState<Mode>("off");
  const [autoRelease, setAutoRelease] = useState(false);
  const [value, setValue] = useState<string>("15");
  const [cap, setCap] = useState<string>("");
  const [saving, setSaving] = useState(false);
  // The inline "Saved" beat on the button itself — the same confirmation the
  // profile editor's SaveBar gives (src/components/profile/profileEditForm/SaveBar.tsx).
  // Without it a successful save changed NOTHING on screen: success toasts are
  // suppressed app-wide (toastPolicy.ts), the haptic is a no-op on web, and
  // re-seeding writes back the values already showing. press-every-control run
  // 35813177418 scored "Save" here "no observable change" for both accounts —
  // exactly this file's own quoted report, "when I click save nothing happens
  // like it didn't work".
  const [justSaved, setJustSaved] = useState(false);
  const justSavedTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(justSavedTimer.current), []);
  const [loaded, setLoaded] = useState(false);
  // "Other" is chosen explicitly (or seeded from a value no pill matches), so
  // tapping it with 15% still selected opens the field instead of doing nothing.
  const [other, setOther] = useState(false);
  // The mode the switch turns back on to: whatever was set before it went off.
  const lastOnMode = useRef<Exclude<Mode, "off">>("percent");
  // The custom amount typed under Other, kept while a pill is tried instead.
  const otherDraft = useRef<{ mode: Exclude<Mode, "off">; value: string } | null>(null);

  // Seed from the profile once it arrives. Guarded by `loaded` so a later
  // profile refetch can't stomp edits the user is in the middle of making.
  useEffect(() => {
    if (!profile || loaded) return;
    const p = profile as unknown as {
      auto_tip_mode?: Mode | null;
      auto_tip_value?: number | null;
      auto_tip_cap?: number | null;
      auto_release_on_complete?: boolean | null;
    };
    setMode(p.auto_tip_mode ?? "off");
    setAutoRelease(p.auto_release_on_complete ?? false);
    if (p.auto_tip_value != null) setValue(String(p.auto_tip_value));
    if (p.auto_tip_cap != null) setCap(String(p.auto_tip_cap));
    const seededMode = p.auto_tip_mode ?? "off";
    if (seededMode !== "off") {
      lastOnMode.current = seededMode;
      const custom = !CHIPS.some((c) => c.mode === seededMode && c.value === p.auto_tip_value);
      setOther(custom);
      if (custom && p.auto_tip_value != null) otherDraft.current = { mode: seededMode, value: String(p.auto_tip_value) };
    }
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
      toast.error("Couldn't save these settings — try again?");
      return;
    }
    if (!updated || updated.length === 0) {
      report(new Error("AutoTip update matched no rows"), {
        tags: { source: "AutoTip.save" },
        context: { user_id: user.id, mode },
      });
      // Save persists only the tip amount and cap (the switches save on flip).
      toast.error("Couldn't save your tip amount", {
        description: "We couldn't reach your profile. Try again in a moment.",
      });
      return;
    }
    // NO success toast here, deliberately — checked 2026-08-31 before adding
    // one. `applyToastPolicy()` (src/lib/toastPolicy.ts) neuters every
    // action-less `toast.success` app-wide by owner decision (2026-08-13:
    // confirmations read as clutter and covered the page header), so a
    // "Saved." here would be dead code that looks live. The confirmation on
    // this screen is the haptic below plus the re-seeded values; that is the
    // app-wide convention, not a gap in this page.
    // Pull the profile back through so the value the page re-seeds from next
    // time is the value that actually persisted, not the local state that
    // happened to be on screen. The realtime `profiles` subscription in
    // useCurrentUser usually invalidates this already, but it is best-effort
    // (and drops on a cold native socket) — this makes the read-back certain.
    void refresh();
    void hapticLight();
    setJustSaved(true);
    window.clearTimeout(justSavedTimer.current);
    justSavedTimer.current = window.setTimeout(() => setJustSaved(false), 2500);
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

  const isPercent = mode === "percent";
  const on = mode !== "off";
  const chosenChip = other ? null : CHIPS.find((c) => c.mode === mode && String(c.value) === value) ?? null;
  const captionClass = "font-sans text-ds-12 text-muted-foreground";

  const pickChip = (c: (typeof CHIPS)[number]) => {
    void hapticLight();
    // Keep what was typed under Other, so tapping a pill to compare and then
    // Other again brings it back instead of the pill's number.
    if (other) otherDraft.current = { mode: mode === "fixed" ? "fixed" : "percent", value };
    setOther(false);
    setMode(c.mode);
    setValue(String(c.value));
  };
  const pickOther = () => {
    void hapticLight();
    if (other) return;
    setOther(true);
    if (otherDraft.current) {
      setMode(otherDraft.current.mode);
      setValue(otherDraft.current.value);
    }
  };
  // Changing the unit clears the number: "25" typed as a percent must never
  // quietly become $25 a job (or $40 become 40% of every job).
  const pickUnit = (m: Exclude<Mode, "off">) => {
    void hapticLight();
    if (m === mode) return;
    setMode(m);
    setValue("");
  };
  // Audit #41 (lead 2026-10-21): the two SWITCHES save the moment they flip,
  // like every other settings switch; the tip AMOUNT and cap keep the explicit
  // Save below (money is never saved on blur). Optimistic, reverted on failure.
  type SwitchPatch = { auto_tip_mode?: Mode; auto_tip_value?: number | null; auto_tip_cap?: number | null; auto_release_on_complete?: boolean };
  const writeNow = async (patch: SwitchPatch, source: string): Promise<boolean> => {
    if (!user?.id) {
      toast.error("You're signed out — sign in again to change this.");
      return false;
    }
    const { data: updated, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("user_id", user.id)
      .select("user_id");
    if (error || !updated || updated.length === 0) {
      report(error ?? new Error("AutoTip switch update matched no rows"), { tags: { source }, context: { user_id: user.id } });
      toast.error("Couldn't save that change — try again?");
      return false;
    }
    void refresh();
    return true;
  };

  // One write in flight per switch: a second flip waits for the first to land,
  // so the screen and the database can never end up disagreeing (money review).
  const [tipBusy, setTipBusy] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);

  const toggleOn = async (next: boolean) => {
    void hapticLight();
    const nextMode: Mode = next ? lastOnMode.current : "off";
    if (next) {
      // Turning on saves the amount shown. If it (or the cap) is not a valid
      // amount, the switch stays OFF and says why: never "on" over a database
      // that says off (money review).
      const onLimits = nextMode === "percent" ? LIMITS.percent : LIMITS.fixed;
      const amountOk = Number.isFinite(numericValue) && numericValue >= onLimits.min && numericValue <= onLimits.max;
      const capOk = nextMode !== "percent" || numericCap === null
        || (Number.isFinite(numericCap) && numericCap >= LIMITS.cap.min && numericCap <= LIMITS.cap.max);
      if (!amountOk || !capOk) {
        toast.error(!amountOk ? "Pick a tip amount first." : "Fix the maximum per job first.");
        return;
      }
    }
    const before = mode;
    if (!next) lastOnMode.current = mode === "off" ? lastOnMode.current : mode;
    setMode(nextMode);
    setTipBusy(true);
    const ok = await writeNow(
      next
        ? { auto_tip_mode: nextMode, auto_tip_value: numericValue, auto_tip_cap: nextMode === "percent" ? numericCap : null }
        : { auto_tip_mode: "off", auto_tip_value: null, auto_tip_cap: null },
      "AutoTip.toggle",
    );
    setTipBusy(false);
    if (!ok) setMode(before);
  };

  const toggleRelease = async (next: boolean) => {
    void hapticLight();
    setAutoRelease(next);
    setReleaseBusy(true);
    const ok = await writeNow({ auto_release_on_complete: next }, "AutoTip.release");
    setReleaseBusy(false);
    if (!ok) setAutoRelease(!next);
  };

  return (
    <ProfileTabBody>
      <ProfileTabHeader title="After a job" onBack={onBack} />
      {/* Profile.tsx owns the shell — AppShell plus the single centered content
          column. This tab contributes nothing but its own vertical rhythm. */}
      <div className="space-y-section">
        <div className="space-y-4">
          {/* Board 182: one switch card, then the default tip as pills. The
              switch IS the old "Off" tile; "Percent"/"Fixed" became the chips
              themselves (10% 15% 20% $5 flat) with "Other" for anything else. */}
          <section className="liquid-glass rounded-ds-md p-card flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 id="auto-tip-heading" className="font-sans font-semibold text-ds-14 text-foreground">
                Tip automatically after each job
              </h2>
              <p id="auto-tip-desc" className="font-sans text-ds-12 leading-snug text-muted-foreground">
                Charged after the job is finished, never before.
              </p>
            </div>
            <Switch
              checked={on}
              onCheckedChange={(v) => void toggleOn(v)}
              disabled={tipBusy}
              aria-labelledby="auto-tip-heading"
              aria-describedby="auto-tip-desc"
              className="shrink-0"
            />
          </section>

          {on && (
            <div className="space-y-4">
              <div className="space-y-2">
                <p id="auto-tip-amount-label" className="font-sans text-ds-14 font-semibold text-foreground">
                  Default tip
                </p>
                <div role="radiogroup" aria-labelledby="auto-tip-amount-label" className="flex flex-wrap gap-2">
                  {/* px-3, not the pill's px-4: all five fit one row at 375. */}
                  {CHIPS.map((c) => (
                    <ChoicePill key={c.label} selected={chosenChip === c} onClick={() => pickChip(c)} className="px-3">
                      {c.label}
                    </ChoicePill>
                  ))}
                  <ChoicePill selected={other} onClick={pickOther} className="px-3">
                    Other
                  </ChoicePill>
                </div>
              </div>

              {other && (
                <div className="space-y-2">
                  <div role="radiogroup" aria-label="Tip as" className="flex gap-2">
                    {(["percent", "fixed"] as const).map((m) => (
                      <ChoicePill key={m} selected={mode === m} onClick={() => pickUnit(m)}>
                        {m === "percent" ? "Percent of the job" : "Dollar amount"}
                      </ChoicePill>
                    ))}
                  </div>
                  <label htmlFor="auto-tip-custom" className={`block ${captionClass}`}>
                    {isPercent ? "Your percent" : "Your amount per job"}
                  </label>
                  {/* The unit lives ON the field, not only in the caption above it.
                      `aria-hidden` on the marker so the accessible name stays the
                      visible `<label>` rather than gaining a stray "$". */}
                  <div className="relative">
                    {!isPercent && (
                      <span aria-hidden="true" className={`${UNIT_MARK} left-3`}>$</span>
                    )}
                    <input
                      id="auto-tip-custom"
                      type="number"
                      inputMode="numeric"
                      min={limits.min}
                      max={limits.max}
                      value={value}
                      placeholder="Type an amount"
                      onChange={(e) => setValue(e.target.value)}
                      className={`${FIELD_BASE} ${isPercent ? "pl-3 pr-9" : "pl-8 pr-3"}`}
                      style={fieldStyle(valueValid || value.trim() === "")}
                    />
                    {isPercent && (
                      <span aria-hidden="true" className={`${UNIT_MARK} right-3`}>%</span>
                    )}
                  </div>
                  {!valueValid && value.trim() !== "" && (
                    <p className="font-sans text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
                      {isPercent ? "Pick between 1% and 50%." : `Pick between $${LIMITS.fixed.min} and $${LIMITS.fixed.max}.`}
                    </p>
                  )}
                </div>
              )}

              {isPercent && (
                <div className="space-y-2">
                  <label htmlFor="auto-tip-cap" className={`block ${captionClass}`}>
                    Maximum per job (optional)
                  </label>
                  {/* `$`, always. This field sits directly under a row of
                      percentages, so a bare "15" here and a "15%" there made the
                      same two digits mean two different things on one screen. */}
                  <div className="relative">
                    <span aria-hidden="true" className={`${UNIT_MARK} left-3`}>$</span>
                    <input
                      id="auto-tip-cap"
                      type="number"
                      inputMode="numeric"
                      min={LIMITS.cap.min}
                      max={LIMITS.cap.max}
                      value={cap}
                      placeholder="No maximum"
                      onChange={(e) => setCap(e.target.value)}
                      className={`${FIELD_BASE} pl-8 pr-3`}
                      style={fieldStyle(capValid)}
                    />
                  </div>
                  {/* The cap is the whole reason percentage mode is safe to offer:
                      15% of a $600 job is $90, which is not what most people
                      picture when they set "15%". */}
                  <p className="font-sans text-ds-11 text-muted-foreground">
                    A percentage of a large job adds up. A maximum keeps it predictable.
                  </p>
                </div>
              )}

              {example != null && (
                <div className="liquid-glass rounded-ds-md p-card">
                  <p className="text-ds-13 font-sans text-foreground">
                    On a <span className="font-semibold">$150</span> job you'd tip{" "}
                    <span className="font-semibold">${formatPrice(example)}</span>
                    {cappedByMax ? (
                      <> — {numericValue}% would be ${formatPriceExact(uncapped!)}, held to your ${formatPrice(numericCap!)} maximum.</>
                    ) : (
                      "."
                    )}
                    {example > 0 && (
                      <>
                        {" "}Your Helpr receives all ${formatPriceExact(example)}; you pay{" "}
                        <span className="font-semibold">{centsLabel(tipQuoteForDollars(example).chargeCents)}</span> in total.
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          <p className={captionClass}>
            Your Helpr gets 100% of every tip. If you
            haven't saved a card, we'll ask you to confirm the tip instead of charging it.
          </p>
        </div>

        {/* Instant release: its own card, same row shape as the auto-tip switch
            above. It saves the moment it flips (audit #41). Safe to offer because completion is DB-gated (photos + 30-min
            floor, 20260824235000); release fires on the next auto-release pass,
            which runs every 30 minutes. */}
        <section className="liquid-glass rounded-ds-md p-card flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="instant-release-heading" className="font-sans font-semibold text-ds-14 text-foreground">
              Instant release
            </h2>
            <p id="instant-release-desc" className="font-sans text-ds-12 leading-snug text-muted-foreground">
              Release payment as soon as the Helpr marks the job done with photo
              proof, instead of holding it for your 24-hour review.
            </p>
          </div>
          <Switch
            checked={autoRelease}
            onCheckedChange={(v) => void toggleRelease(v)}
            disabled={releaseBusy}
            aria-labelledby="instant-release-heading"
            aria-describedby="instant-release-desc"
            className="shrink-0"
          />
        </section>

        {/* Only the tip AMOUNT needs Save (the switches save on flip), so
            the button shows only while a tip is on (audit #41). */}
        {mode !== "off" && (
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={saving || justSaved || tipBusy || !valueValid || !capValid}
          className="w-full rounded-full"
        >
          {saving ? "Saving…" : justSaved ? (<><Check className="w-4 h-4 mr-1.5" strokeWidth={3} aria-hidden /> Saved</>) : "Save tip amount"}
        </Button>
        )}
      </div>
    </ProfileTabBody>
  );
};

export default AutoTip;
