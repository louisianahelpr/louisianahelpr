import { useEffect, useState } from "react";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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

/** SELECTED = the app's shared glossy primary surface, never a flat tint.
 *  Standing project rule (see `glossyPrimaryInvariant.test.ts` and the note in
 *  EarningsRangeToggle): a chosen control wears `btn-grad-primary`, the same
 *  radial bark gradient as every primary CTA. Until 2026-08-31 both tile rows
 *  here painted a flat `hsl(var(--bark) / 0.15)` INLINE — which is why the
 *  invariant test could not see them: it reads className strings, and an
 *  inline `style` fill is invisible to it. Declared once so the two rows can
 *  never drift from each other again. */
const TILE_ACTIVE =
  "btn-grad-primary !text-[hsl(var(--parchment))] " +
  "shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_2px_8px_-3px_hsl(var(--bark)/0.55)]";
/** `min-h-[44px]` is load-bearing, not decoration. The app-wide
 *  `button { min-height: 44px }` in index.css explicitly EXCLUDES
 *  `[role="radio"]`, so the moment these tiles gained real radio semantics
 *  they also lost their automatic touch target. Declare the height that
 *  actually renders — the same trap EarningsRangeToggle documents. */
const TILE_BASE =
  // `overflow-hidden` is a backstop, not the fix: the labels are short enough
  // to fit at 320 (measured), and this only guarantees a future longer one
  // clips inside its own tile instead of printing over its neighbour.
  "min-h-[44px] overflow-hidden rounded-ds-md text-ds-13 font-sans font-semibold transition-all " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** A number field is 36.8px tall on its own line (measured on the maximum-per-job
 *  input at every breakpoint) — under the 44px minimum. `min-h-[44px]` is the fix;
 *  inputs are not covered by the global touch-target rule. */
const FIELD_BASE =
  "w-full min-h-[44px] py-2 rounded-ds-sm text-ds-13 font-sans font-semibold";

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
 */
const AutoTip = () => {
  usePageTitle("After a Job — Helpr");
  const { user, profile, refresh } = useCurrentUser();

  const [mode, setMode] = useState<Mode>("off");
  const [autoRelease, setAutoRelease] = useState(false);
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
      auto_release_on_complete?: boolean | null;
    };
    setMode(p.auto_tip_mode ?? "off");
    setAutoRelease(p.auto_release_on_complete ?? false);
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
        auto_release_on_complete: autoRelease,
      })
      .eq("user_id", user.id)
      .select("user_id");
    setSaving(false);
    if (error) {
      report(error, { tags: { source: "AutoTip.save" } });
      toast.error("Couldn't save these settings.", { description: error.message });
      return;
    }
    if (!updated || updated.length === 0) {
      report(new Error("AutoTip update matched no rows"), {
        tags: { source: "AutoTip.save" },
        context: { user_id: user.id, mode },
      });
      // "these settings", not "your auto-tip": one Save persists BOTH the tip
      // and the release toggle, so naming only the tip left a poster who had just
      // flipped Instant Release unsure whether that half had landed.
      toast.error("Couldn't save these settings.", {
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
  /** The unit the amount fields are denominated in. This screen prints
   *  percentages and dollars one under the other — "15" meant a percent in the
   *  tile row and dollars in the maximum field, with nothing on either control
   *  saying which. Every amount input now carries its own marker. */
  const captionClass = "font-serif italic text-ds-12";
  const captionStyle = { color: "hsl(var(--olivewood) / 0.8)" } as const;

  return (
    <AppPage title="After a Job" backTo="/profile">
      {/* AppPage owns the shell — AppShell + ProfileTabHeader + the single
          centered content column. This page contributes nothing but its own
          vertical rhythm; re-adding a `page-measure`/gutter wrapper here would
          be a second max-width inside AppPage's own. */}
      <div className="space-y-5">
        <section className="liquid-glass rounded-ds-md p-5 space-y-4">
          <h2 className="font-display font-bold text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
            Automatic Tip
          </h2>
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

          <div role="radiogroup" aria-label="Automatic tip" className="grid grid-cols-3 gap-2">
            {(["off", "percent", "fixed"] as const).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => { void hapticLight(); setMode(m); }}
                  className={`${TILE_BASE} px-1 ${active ? TILE_ACTIVE : ""}`}
                  style={
                    active
                      ? { border: "1px solid hsl(var(--bark-deep) / 0.55)" }
                      : {
                          background: "transparent",
                          border: "1px solid hsl(var(--bark) / 0.18)",
                          color: "hsl(var(--bark))",
                        }
                  }
                >
                  {/* "Percent", not "Percentage". Measured at 320: each tile is
                      66px wide (56px inside the padding) and "Percentage"
                      renders 82px — it spilled out of both sides of its own
                      tile and printed over the "Fixed" tile beside it, which is
                      visible in the owner's screenshot and predates this pass.
                      "Percent" renders 52.7px, fits with 3px to spare, and
                      matches the caption it controls ("Percent of the job"). */}
                  {m === "off" ? "Off" : m === "percent" ? "Percent" : "Fixed"}
                </button>
              );
            })}
          </div>

          {mode !== "off" && (
            <div className="space-y-2">
              <p id="auto-tip-amount-label" className={captionClass} style={captionStyle}>
                {isPercent ? "Percent of the job" : "Amount per job"}
              </p>
              {/* A grid, not a wrapping flex row with the custom field as a
                  fourth cell. The custom field used to sit INSIDE this row as a
                  bare `15` beside `10%` and `20%` — three tiles carrying their
                  unit and a fourth that looked like a fourth preset and read as
                  a fourth value. Presets are a choice; the field below is an
                  entry. Different jobs, different rows. */}
              <div
                role="radiogroup"
                aria-labelledby="auto-tip-amount-label"
                className="grid grid-cols-3 gap-2"
              >
                {(isPercent ? PERCENT_PRESETS : FIXED_PRESETS).map((n) => {
                  const active = String(n) === value;
                  return (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => { void hapticLight(); setValue(String(n)); }}
                      className={`${TILE_BASE} px-1 ${active ? TILE_ACTIVE : ""}`}
                      style={
                        active
                          ? { border: "1px solid hsl(var(--bark-deep) / 0.55)" }
                          : {
                              background: "transparent",
                              border: "1px solid hsl(var(--bark) / 0.18)",
                              color: "hsl(var(--bark))",
                            }
                      }
                    >
                      {isPercent ? `${n}%` : `$${n}`}
                    </button>
                  );
                })}
              </div>

              <label htmlFor="auto-tip-custom" className={`block ${captionClass}`} style={captionStyle}>
                {isPercent ? "Or a custom percent" : "Or a custom amount"}
              </label>
              {/* The unit lives ON the field, not only in the caption above it.
                  `aria-hidden` on the marker so the accessible name stays the
                  visible `<label>` rather than gaining a stray "$". */}
              <div className="relative">
                {!isPercent && (
                  <span
                    aria-hidden="true"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-ds-13 font-sans font-semibold pointer-events-none"
                    style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                  >
                    $
                  </span>
                )}
                <input
                  id="auto-tip-custom"
                  type="number"
                  inputMode="numeric"
                  min={limits.min}
                  max={limits.max}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className={`${FIELD_BASE} ${isPercent ? "pl-3 pr-9" : "pl-8 pr-3"}`}
                  style={{
                    background: "transparent",
                    border: `1px solid hsl(var(--${valueValid ? "bark" : "burnt-sienna"}) / 0.40)`,
                    color: "hsl(var(--bark))",
                    outline: "none",
                  }}
                />
                {isPercent && (
                  <span
                    aria-hidden="true"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ds-13 font-sans font-semibold pointer-events-none"
                    style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                  >
                    %
                  </span>
                )}
              </div>
              {!valueValid && (
                <p className="font-serif italic text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
                  {isPercent ? "Pick between 1% and 50%." : `Pick between $${LIMITS.fixed.min} and $${LIMITS.fixed.max}.`}
                </p>
              )}
            </div>
          )}

          {isPercent && (
            <div className="space-y-2">
              <label htmlFor="auto-tip-cap" className={`block ${captionClass}`} style={captionStyle}>
                Maximum per job — optional
              </label>
              {/* `$`, always. This field sits directly under a row of
                  percentages, so a bare "15" here and a "15%" there made the
                  same two digits mean two different things on one screen. */}
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-ds-13 font-sans font-semibold pointer-events-none"
                  style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                >
                  $
                </span>
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
                  style={{
                    background: "transparent",
                    border: `1px solid hsl(var(--${capValid ? "bark" : "burnt-sienna"}) / 0.40)`,
                    color: "hsl(var(--bark))",
                    outline: "none",
                  }}
                />
              </div>
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
        </section>

        {/* Instant release gets its own section, not a subsection of the tip
            (issue #172). The two used to share one <section> with no heading of
            its own — a release-timing preference is a different question from a
            tip amount, so burying it inside the tip card read as a stray toggle
            rather than its own setting. Same card chrome + heading treatment as
            the tip section above; Save still persists both in one write (they're
            one profile row), so the button stays below both rather than
            duplicating inside each. Kept here because both answer "what happens
            automatically once the job is finished?" — which is now what the page
            is CALLED (owner, 2026-08-31). Safe to offer because completion is
            DB-gated (photos + 30-min floor, 20260824235000); release fires on
            the next auto-release pass, which runs every 30 minutes.

            ONE heading, not two. The `h2` used to say "Instant Release" and the
            row beneath it "Release on completion" — the same sentence twice, in
            two type treatments, over a single switch. The section heading is the
            name; the italic line is what it does. */}
        <section className="liquid-glass rounded-ds-md p-5 space-y-3">
          <h2
            id="instant-release-heading"
            className="font-display font-bold text-ds-14"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Instant Release
          </h2>
          <div
            className="rounded-ds-md p-3 flex items-center justify-between gap-3"
            style={{ background: "hsl(var(--bark) / 0.06)", border: "0.5px solid hsl(var(--bark) / 0.18)" }}
          >
            <p
              id="instant-release-desc"
              className="min-w-0 font-serif italic text-ds-12 leading-snug"
              style={{ color: "hsl(var(--olivewood) / 0.85)" }}
            >
              Release payment as soon as the Helpr marks the job done with photo
              proof — instead of holding it for your 24-hour review.
            </p>
            <Switch
              checked={autoRelease}
              onCheckedChange={setAutoRelease}
              aria-labelledby="instant-release-heading"
              aria-describedby="instant-release-desc"
              className="shrink-0"
            />
          </div>
        </section>

        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={saving || !valueValid || !capValid}
          className="w-full rounded-ds-md"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        {/* A trailing explainer card used to sit here. Removed on owner
            instruction: it was a second explanation of the same feature at the
            far end of a short screen, after the Save button had already ended
            it. Its one piece of load-bearing behaviour — that an unsaved card
            means we confirm the tip rather than auto-charge it — was folded
            into the opening paragraph rather than lost. */}
      </div>
    </AppPage>
  );
};

export default AutoTip;
