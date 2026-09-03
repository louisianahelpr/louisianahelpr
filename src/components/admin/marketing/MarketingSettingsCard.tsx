// The kill switch, and everything that governs whether a queued row can reach
// the public.
//
// ── THE ONE RULE THIS FILE EXISTS TO ENFORCE ──────────────────────────────
// When the settings cannot be read, this must NOT render as if auto-publish is
// off. "Off" is the reassuring answer, and rendering it on no evidence is the
// single most dangerous thing this screen could do: the owner would see a calm
// grey "not publishing" banner and walk away while posts were going out. So a
// failed read gets its own loud, third state — UNKNOWN — that says plainly
// that the switch could not be read and must not be assumed off.
//
// The same reasoning drives the ordering below: the switch is first on the
// page, above the queue, because it is the control you reach for when
// something is going wrong live.

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RadioTower, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";
import { AdminCard } from "@/components/admin/AdminViewShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { mutationErrorMessage } from "@/lib/mutationResult";
import { report } from "@/lib/errorLogger";
import {
  CHANNEL_LABEL,
  MARKETING_CHANNELS,
  formatDateTime,
  isChannelEnabled,
  type MarketingChannel,
  type MarketingSettingsRow,
} from "./marketingTypes";
import { updateMarketingSettings } from "./marketingApi";

interface Props {
  settings: MarketingSettingsRow | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onChanged: () => void;
}

/** Plain-language statement of what ON means. Written once, shown in both the
 *  live banner and the confirm dialog, so the confirm cannot drift from the
 *  banner and under-describe what is being switched on. */
const ON_MEANS =
  "Posts go to your Facebook Page and Instagram automatically, without review.";

export function MarketingSettingsCard({
  settings,
  isLoading,
  isError,
  error,
  onRetry,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [confirmOn, setConfirmOn] = useState(false);
  const [confirmChannel, setConfirmChannel] = useState<MarketingChannel | null>(null);
  const [capDraft, setCapDraft] = useState("");

  // Keep the cap field in step with the server value, but never while the
  // owner is mid-edit on it — a background refetch overwriting a half-typed
  // number is how a "2" becomes a "20".
  useEffect(() => {
    if (settings && document.activeElement?.getAttribute("data-field") !== "daily-cap") {
      setCapDraft(String(settings.daily_post_cap));
    }
  }, [settings]);

  const save = async (patch: Parameters<typeof updateMarketingSettings>[0], done: string) => {
    setBusy(true);
    try {
      await updateMarketingSettings(patch);
      toast.success(done);
      onChanged();
    } catch (err) {
      report(err, { tags: { source: "MarketingSettingsCard.save" } });
      toast.error(mutationErrorMessage(err, "Couldn't save that — try again."));
    } finally {
      setBusy(false);
    }
  };

  // ── State 1: still loading ──────────────────────────────────────────────
  if (isLoading) {
    return (
      <AdminCard title="Auto-publish">
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-10 w-2/3 rounded-lg" />
        </div>
      </AdminCard>
    );
  }

  // ── State 2: UNKNOWN. The dangerous one. ────────────────────────────────
  // Deliberately styled like the ON state, not like the OFF state: if we
  // cannot tell, the owner should treat it as live until proven otherwise.
  //
  // The condition is `!settings`, NOT `isError || !settings`. A failed
  // BACKGROUND refetch (this query refetches on window focus) still has the
  // last known value in cache, and blanking the card on a transient blip would
  // take the OFF switch off the screen — removing the stop button at exactly
  // the moment someone came back to the tab to use it. A stale-but-known state
  // with a visible warning beats no state at all; the warning strip below
  // covers that case.
  if (!settings) {
    return (
      <AdminCard title="Auto-publish">
        <div
          className="rounded-xl border-2 p-4 sm:p-5"
          style={{
            borderColor: "hsl(var(--destructive))",
            background: "hsl(var(--destructive) / 0.08)",
          }}
        >
          <div className="flex items-start gap-3">
            <ShieldQuestion
              className="mt-0.5 h-6 w-6 shrink-0"
              style={{ color: "hsl(var(--destructive))" }}
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-2">
              <p
                className="font-display text-ds-16 font-semibold"
                style={{ color: "hsl(var(--destructive))" }}
              >
                Auto-publish state unknown
              </p>
              <p className="text-ds-13 text-foreground">
                The settings couldn't be read, so this screen cannot tell you whether posts are
                publishing automatically right now. <strong>Do not assume it is off.</strong>
              </p>
              <p className="text-ds-11 text-muted-foreground">
                {error instanceof Error ? error.message : "The settings request failed."}
              </p>
              <Button size="sm" variant="outline" onClick={onRetry}>
                Try again
              </Button>
            </div>
          </div>
        </div>
      </AdminCard>
    );
  }

  // ── State 3: known ──────────────────────────────────────────────────────
  const on = settings.auto_publish_enabled;
  const capChanged = capDraft.trim() !== String(settings.daily_post_cap);
  const capValue = Number(capDraft);
  const capValid = Number.isInteger(capValue) && capValue >= 0;

  const requestChannelToggle = (channel: MarketingChannel, next: boolean) => {
    // Switching a channel ON while the master switch is already ON puts that
    // account live immediately — same consequence as flipping the master, so
    // it earns the same confirm. Switching OFF is never gated.
    if (next && on) {
      setConfirmChannel(channel);
      return;
    }
    void applyChannel(channel, next);
  };

  const applyChannel = (channel: MarketingChannel, next: boolean) => {
    const current: Record<string, boolean> = {};
    for (const c of MARKETING_CHANNELS) current[c] = isChannelEnabled(settings, c);
    current[channel] = next;
    return save(
      { channels_enabled: current },
      `${CHANNEL_LABEL[channel]} ${next ? "enabled" : "disabled"}.`,
    );
  };

  return (
    <>
      <AdminCard
        title="Auto-publish"
        subtitle={`Last changed ${formatDateTime(settings.updated_at) || "—"}`}
      >
        {/* A failed refresh over a known value. The switch below still works
            and still reflects the last confirmed state — but the owner is told
            it may be out of date rather than being shown a stale value that
            silently presents itself as current. */}
        {isError && (
          <div
            className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2"
            style={{
              borderColor: "hsl(var(--burnt-sienna) / 0.4)",
              background: "hsl(var(--burnt-sienna) / 0.08)",
            }}
          >
            <AlertTriangle
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: "hsl(var(--burnt-sienna))" }}
              aria-hidden="true"
            />
            <p className="text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
              Couldn't refresh — this shows the last confirmed state and may be out of date.
            </p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              Refresh
            </Button>
          </div>
        )}

        {/* The banner. Unmistakable at a glance is the requirement, so ON is a
            saturated destructive-bordered block with a live icon, and OFF is a
            visibly inert muted block — not two shades of the same card. */}
        <div
          className="rounded-xl border-2 p-4 sm:p-5"
          style={
            on
              ? {
                  borderColor: "hsl(var(--destructive))",
                  background: "hsl(var(--destructive) / 0.08)",
                }
              : { borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.4)" }
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <RadioTower
                className="mt-0.5 h-6 w-6 shrink-0"
                style={{ color: on ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))" }}
                aria-hidden="true"
              />
              <div className="min-w-0 space-y-1">
                <p
                  className="font-display text-ds-16 font-semibold"
                  style={{ color: on ? "hsl(var(--destructive))" : "hsl(var(--foreground))" }}
                >
                  {on ? "Auto-publish is ON" : "Auto-publish is OFF"}
                </p>
                <p className="text-ds-13 text-foreground">
                  {on
                    ? ON_MEANS
                    : "Nothing publishes automatically. Scheduled posts stay in the queue until you turn this on."}
                </p>
              </div>
            </div>

            {/* OFF is the stop button: instant, no confirm, never gated behind
                a dialog. ON goes through a confirm. */}
            <div className="flex shrink-0 items-center gap-3">
              {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Label htmlFor="auto-publish" className="sr-only">
                Auto-publish
              </Label>
              <Switch
                id="auto-publish"
                checked={on}
                disabled={busy}
                onCheckedChange={(next) => {
                  if (next) setConfirmOn(true);
                  else void save({ auto_publish_enabled: false }, "Auto-publish stopped.");
                }}
              />
            </div>
          </div>
        </div>

        {/* Per-channel opt-in. Shown as "off" whenever the key is absent, which
            is the migration's own contract for this jsonb. */}
        <div className="mt-5 space-y-3">
          <p className="text-ds-11 font-semibold uppercase tracking-wide text-muted-foreground">
            Channels
          </p>
          {MARKETING_CHANNELS.map((channel) => {
            const enabled = isChannelEnabled(settings, channel);
            return (
              <div
                key={channel}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <Label htmlFor={`channel-${channel}`} className="text-ds-13 font-medium">
                    {CHANNEL_LABEL[channel]}
                  </Label>
                  <p className="text-ds-11 text-muted-foreground">
                    {enabled
                      ? on
                        ? "Live — posts for this channel publish automatically."
                        : "Enabled, but held by the master switch above."
                      : "Off — nothing publishes to this channel."}
                  </p>
                </div>
                <Switch
                  id={`channel-${channel}`}
                  checked={enabled}
                  disabled={busy}
                  onCheckedChange={(next) => requestChannelToggle(channel, next)}
                />
              </div>
            );
          })}
        </div>

        {/* The ceiling. A generation bug that produces 400 rows cannot become
            400 posts, so this number is worth showing next to the switch. */}
        <div className="mt-5 space-y-2">
          <Label htmlFor="daily-cap" className="text-ds-13 font-medium">
            Daily post cap
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="daily-cap"
              data-field="daily-cap"
              type="number"
              min={0}
              inputMode="numeric"
              className="w-28"
              value={capDraft}
              onChange={(e) => setCapDraft(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !capChanged || !capValid}
              onClick={() => void save({ daily_post_cap: capValue }, "Daily cap saved.")}
            >
              Save
            </Button>
          </div>
          <p className="text-ds-11 text-muted-foreground">
            Maximum posts published per channel per UTC day. Counted against posts that actually
            went out, not against what's queued.
            {!capValid && capChanged ? " Enter a whole number of 0 or more." : ""}
          </p>
        </div>
      </AdminCard>

      <BrandConfirmDialog
        open={confirmOn}
        onOpenChange={setConfirmOn}
        title="Turn on auto-publish?"
        description={ON_MEANS}
        callout={{
          icon: AlertTriangle,
          text: "Scheduled posts whose time has already passed will go out on the next dispatcher run — check the queue below first. You can turn this off again at any time, instantly.",
        }}
        primaryLabel="Turn on"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => {
          setConfirmOn(false);
          void save({ auto_publish_enabled: true }, "Auto-publish is ON.");
        }}
        secondaryLabel="Cancel"
      />

      <BrandConfirmDialog
        open={confirmChannel !== null}
        onOpenChange={(open) => !open && setConfirmChannel(null)}
        title={confirmChannel ? `Enable ${CHANNEL_LABEL[confirmChannel]}?` : ""}
        description={
          confirmChannel
            ? `Auto-publish is already on, so enabling this puts ${CHANNEL_LABEL[confirmChannel]} live straight away — queued posts for it will publish without review.`
            : ""
        }
        primaryLabel="Enable"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => {
          const channel = confirmChannel;
          setConfirmChannel(null);
          if (channel) void applyChannel(channel, true);
        }}
        secondaryLabel="Cancel"
      />
    </>
  );
}
