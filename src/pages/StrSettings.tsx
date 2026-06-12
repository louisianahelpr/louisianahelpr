/**
 * StrSettings — /str-settings
 *
 * "Rental Host Automation" settings page. Lets users connect Airbnb / VRBO
 * iCal feeds so Helpr auto-posts a cleaning job each time a guest checks out.
 *
 * Document-scroll page (listed in DOCUMENT_SCROLL_ROUTES). Uses BackButton +
 * the standard min-h-screen wrapper — same pattern as SubscriptionPage.
 */

import { useState } from "react";
import {
  Home, Plus, ChevronDown, ChevronUp, RefreshCw, Trash2,
  CheckCircle, AlertCircle, Loader2, CalendarDays,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// ---------------------------------------------------------------------------
// Types (derived from DB schema — keep in sync with migration)
// ---------------------------------------------------------------------------
type Platform = "airbnb" | "vrbo" | "booking_com" | "other";

const PLATFORM_LABELS: Record<Platform, string> = {
  airbnb: "Airbnb",
  vrbo: "VRBO",
  booking_com: "Booking.com",
  other: "Other",
};

interface StrConnection {
  id: string;
  platform: Platform;
  ical_url: string;
  property_name: string | null;
  property_address: string | null;
  auto_create_cleaning: boolean;
  cleaning_budget: number | null;
  cleaning_notes: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  is_active: boolean;
}

const PLATFORM_HELP: Record<Platform, string> = {
  airbnb: "https://www.airbnb.com/help/article/99/can-i-export-my-reservations-to-another-calendar",
  vrbo: "https://help.vrbo.com/en-us/articles/360021264494",
  booking_com: "https://partner.booking.com/en-gb/help/other-help-topics/how-do-i-export-my-bookings-to-third-party-calendar",
  other: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatSyncTime(ts: string | null): string {
  if (!ts) return "Never synced";
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "Just synced";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Styles (matching SubscriptionPage / StrSettings design language)
// ---------------------------------------------------------------------------
const cardStyle: React.CSSProperties = {
  background:
    "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.06) 0%, transparent 55%), " +
    "linear-gradient(180deg, hsla(38, 50%, 96%, 0.94) 0%, hsla(38, 30%, 92%, 0.8) 100%)",
  border: "0.5px solid hsl(var(var(--bark)) / 0.18)",
  borderColor: "hsl(var(--bark) / 0.18)",
  boxShadow:
    "inset 0 1px 1px 0 rgba(255,255,255,0.55), " +
    "0 1px 2px hsl(var(--olivewood) / 0.06), " +
    "0 8px 20px -6px hsl(var(--olivewood) / 0.10)",
};

// ---------------------------------------------------------------------------
// Empty-state illustration
// ---------------------------------------------------------------------------
function EmptyConnections() {
  return (
    <div className="flex flex-col items-center py-10 gap-3">
      <div
        className="rounded-full flex items-center justify-center"
        style={{
          width: 56, height: 56,
          background: "hsl(var(--gold-warm) / 0.12)",
          border: "1.5px solid hsl(var(--gold-warm) / 0.3)",
        }}
      >
        <CalendarDays className="w-7 h-7" style={{ color: "hsl(var(--bark))" }} />
      </div>
      <p
        className="font-display italic font-semibold"
        style={{ fontSize: "0.98rem", color: "hsl(var(--ink-deep))" }}
      >
        No calendars connected yet
      </p>
      <p
        className="text-center max-w-xs"
        style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.7)" }}
      >
        Add your first rental calendar below and Helpr will auto-post
        cleaning jobs after every guest checkout.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection card
// ---------------------------------------------------------------------------
interface ConnectionCardProps {
  conn: StrConnection;
  onSync: (id: string) => void;
  onRemove: (id: string) => void;
  syncing: boolean;
}

function ConnectionCard({ conn, onSync, onRemove, syncing }: ConnectionCardProps) {
  const hasError = !!conn.last_sync_error;
  const statusColor = hasError ? "hsl(var(--burnt-sienna))" : "hsl(var(--sage))";
  const StatusIcon = hasError ? AlertCircle : CheckCircle;

  return (
    <div className="rounded-ds-md p-4 space-y-3" style={cardStyle}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Platform badge */}
          <span
            className="shrink-0 rounded-full px-2 py-0.5 font-serif italic font-semibold uppercase"
            style={{
              fontSize: "0.62rem",
              letterSpacing: "0.1em",
              background: "hsl(var(--bark) / 0.1)",
              color: "hsl(var(--bark))",
              border: "0.5px solid hsl(var(--bark) / 0.3)",
            }}
          >
            {PLATFORM_LABELS[conn.platform]}
          </span>
          <p
            className="font-display font-semibold truncate"
            style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))" }}
          >
            {conn.property_name || "Unnamed property"}
          </p>
        </div>
        {/* Sync status */}
        <div className="flex items-center gap-1 shrink-0">
          <StatusIcon className="w-3.5 h-3.5" style={{ color: statusColor }} />
          <span style={{ fontSize: "0.72rem", color: statusColor }}>
            {hasError ? "Error" : formatSyncTime(conn.last_synced_at)}
          </span>
        </div>
      </div>

      {/* Address */}
      {conn.property_address && (
        <p style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.65)" }}>
          {conn.property_address}
        </p>
      )}

      {/* Error message */}
      {hasError && (
        <div
          className="rounded-lg px-3 py-2"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.08)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
          }}
        >
          <p style={{ fontSize: "0.75rem", color: "hsl(var(--burnt-sienna))" }}>
            {conn.last_sync_error}
          </p>
        </div>
      )}

      {/* Budget info row */}
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2"
        style={{ background: "hsl(var(--gold-warm) / 0.08)", border: "0.5px solid hsl(var(--gold-warm) / 0.2)" }}
      >
        <Home className="w-3.5 h-3.5" style={{ color: "hsl(var(--bark))" }} />
        <span style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
          Auto-creates <strong style={{ color: "hsl(var(--ink-deep))" }}>cleaning jobs</strong> at{" "}
          <strong style={{ color: "hsl(var(--ink-deep))" }}>
            ${conn.cleaning_budget ?? 80}/hr
          </strong>
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-0.5">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 rounded-ds-md"
          disabled={syncing}
          onClick={() => onSync(conn.id)}
          style={{ fontSize: "0.8rem", height: 36 }}
        >
          {syncing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
        <button
          aria-label="Remove calendar connection"
          className="flex items-center justify-center rounded-ds-md"
          style={{
            width: 40, height: 36,
            background: "hsl(var(--burnt-sienna) / 0.08)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
            color: "hsl(var(--burnt-sienna))",
          }}
          onClick={() => onRemove(conn.id)}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Calendar form
// ---------------------------------------------------------------------------
interface AddFormState {
  platform: Platform;
  ical_url: string;
  property_name: string;
  property_address: string;
  auto_create_cleaning: boolean;
  cleaning_budget: string;
  cleaning_notes: string;
}

const EMPTY_FORM: AddFormState = {
  platform: "airbnb",
  ical_url: "",
  property_name: "",
  property_address: "",
  auto_create_cleaning: true,
  cleaning_budget: "80",
  cleaning_notes: "",
};

function AddCalendarForm({
  onAdd,
  loading,
}: {
  onAdd: (form: AddFormState) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM);

  const set = <K extends keyof AddFormState>(k: K, v: AddFormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const helpUrl = PLATFORM_HELP[form.platform];

  return (
    <div className="space-y-4">
      {/* Platform selector */}
      <div>
        <Label style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
          Platform
        </Label>
        <div className="flex flex-wrap gap-2 mt-1.5">
          {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => set("platform", p)}
              className="rounded-full px-3 py-1 font-serif italic font-semibold transition-all"
              style={{
                fontSize: "0.78rem",
                background:
                  form.platform === p
                    ? "hsl(var(--bark))"
                    : "hsl(var(--bark) / 0.08)",
                color: form.platform === p ? "hsl(var(--parchment))" : "hsl(var(--bark))",
                border: "0.5px solid hsl(var(--bark) / 0.3)",
              }}
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* iCal URL */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label htmlFor="ical-url" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
            Calendar URL (iCal / .ics)
          </Label>
          {helpUrl && (
            <a
              href={helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "0.72rem", color: "hsl(var(--burnt-sienna))" }}
            >
              How to find this →
            </a>
          )}
        </div>
        <Input
          id="ical-url"
          type="url"
          placeholder="webcal://… or https://…"
          value={form.ical_url}
          onChange={(e) => set("ical_url", e.target.value)}
          className="rounded-ds-md"
        />
      </div>

      {/* Property name + address */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
            Property name
          </Label>
          <Input
            placeholder="e.g. Lakehouse"
            value={form.property_name}
            onChange={(e) => set("property_name", e.target.value)}
            className="rounded-ds-md mt-1"
          />
        </div>
        <div>
          <Label style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
            City / Address
          </Label>
          <Input
            placeholder="e.g. New Orleans, LA"
            value={form.property_address}
            onChange={(e) => set("property_address", e.target.value)}
            className="rounded-ds-md mt-1"
          />
        </div>
      </div>

      {/* Auto-create toggle + budget */}
      <div
        className="rounded-ds-md p-3 space-y-3"
        style={{
          background: "hsl(var(--gold-warm) / 0.06)",
          border: "0.5px solid hsl(var(--gold-warm) / 0.2)",
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium" style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep))" }}>
              Auto-create cleaning job
            </p>
            <p style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.65)" }}>
              Post a job automatically after each checkout
            </p>
          </div>
          <Switch
            checked={form.auto_create_cleaning}
            onCheckedChange={(v) => set("auto_create_cleaning", v)}
          />
        </div>
        {form.auto_create_cleaning && (
          <div>
            <Label style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
              Cleaning budget ($)
            </Label>
            <Input
              type="number"
              min={10}
              max={999}
              placeholder="80"
              value={form.cleaning_budget}
              onChange={(e) => set("cleaning_budget", e.target.value)}
              className="rounded-ds-md mt-1"
            />
          </div>
        )}
      </div>

      {/* Notes */}
      <div>
        <Label style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
          Cleaning notes (optional)
        </Label>
        <Input
          placeholder="Door code, special instructions…"
          value={form.cleaning_notes}
          onChange={(e) => set("cleaning_notes", e.target.value)}
          className="rounded-ds-md mt-1"
        />
      </div>

      <Button
        onClick={() => onAdd(form)}
        disabled={loading || !form.ical_url.trim()}
        className="w-full rounded-ds-md"
        style={{ background: "hsl(var(--bark))", color: "hsl(var(--parchment))" }}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
        {loading ? "Connecting…" : "Connect calendar"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function StrSettings() {
  const [addOpen, setAddOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  // ── Fetch connections ────────────────────────────────────────────────────
  const { data: connections = [], isLoading } = useQuery({
    queryKey: ["str-calendar-connections", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("str_calendar_connections")
        .select("*")
        .eq("user_id", user!.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as StrConnection[];
    },
  });

  // ── Add connection ────────────────────────────────────────────────────────
  const { mutate: addConnection, isPending: adding } = useMutation({
    mutationFn: async (form: AddFormState) => {
      if (!user?.id) throw new Error("Not authenticated");

      const budget = parseFloat(form.cleaning_budget) || 80;

      const { data, error } = await supabase
        .from("str_calendar_connections")
        .insert({
          user_id: user.id,
          platform: form.platform,
          ical_url: form.ical_url.trim().replace(/^webcal:/, "https:"),
          property_name: form.property_name.trim() || null,
          property_address: form.property_address.trim() || null,
          auto_create_cleaning: form.auto_create_cleaning,
          cleaning_budget: budget,
          cleaning_notes: form.cleaning_notes.trim() || null,
        })
        .select("id")
        .single();

      if (error) throw error;

      // Trigger an immediate sync for the new connection — best-effort
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/str-ical-sync`;
          await fetch(fnUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ connection_id: data.id }),
          });
        }
      } catch {
        // Non-fatal — sync will happen on next cron run
      }

      return data;
    },
    onSuccess: () => {
      toast.success("Calendar connected! Checking for upcoming checkouts…");
      setAddOpen(false);
      queryClient.invalidateQueries({ queryKey: ["str-calendar-connections"] });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Failed to connect calendar");
    },
  });

  // ── Manual sync ───────────────────────────────────────────────────────────
  async function handleSync(connectionId: string) {
    setSyncingId(connectionId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/str-ical-sync`;
      const res = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ connection_id: connectionId }),
      });

      if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
      const body = await res.json() as { results?: Array<{ jobs_created?: number; error?: string }> };
      const result = body.results?.[0];

      if (result?.error) {
        toast.error(`Sync error: ${result.error}`);
      } else {
        const n = result?.jobs_created ?? 0;
        toast.success(
          n > 0
            ? `Sync complete — ${n} cleaning job${n === 1 ? "" : "s"} created`
            : "Sync complete — no new checkouts in the next 7 days",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncingId(null);
      queryClient.invalidateQueries({ queryKey: ["str-calendar-connections"] });
    }
  }

  // ── Remove connection ─────────────────────────────────────────────────────
  const { mutate: removeConnection } = useMutation({
    mutationFn: async (connectionId: string) => {
      const { error } = await supabase
        .from("str_calendar_connections")
        .update({ is_active: false })
        .eq("id", connectionId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Calendar removed");
      queryClient.invalidateQueries({ queryKey: ["str-calendar-connections"] });
    },
    onError: () => toast.error("Failed to remove calendar"),
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      {/* Page header */}
      <div className="px-4 pt-safe-top pt-4 pb-2 flex items-center gap-3">
        <BackButton />
        <div>
          <h1
            className="font-display italic font-bold leading-none"
            style={{ fontSize: "1.55rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
          >
            Host Automation
          </h1>
          <p
            className="font-serif italic mt-0.5"
            style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.72)" }}
          >
            Auto-post cleaning jobs on guest checkout
          </p>
        </div>
      </div>

      <div className="px-4 space-y-4 mt-2 pb-8">

        {/* Explanation card */}
        <div className="rounded-ds-md p-4" style={cardStyle}>
          <div className="flex items-start gap-3">
            <div
              className="rounded-full flex items-center justify-center shrink-0"
              style={{
                width: 44, height: 44,
                background: "hsl(var(--gold-warm) / 0.12)",
                border: "1.5px solid hsl(var(--gold-warm) / 0.3)",
              }}
            >
              <Home className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} />
            </div>
            <div>
              <p
                className="font-display italic font-bold"
                style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))" }}
              >
                Never scramble for a cleaner again
              </p>
              <p
                className="mt-1"
                style={{ fontSize: "0.8rem", color: "hsl(var(--olivewood) / 0.75)", lineHeight: 1.5 }}
              >
                Connect your Airbnb or VRBO calendar. When a guest checks out,
                Helpr automatically posts a cleaning job — so you always have
                someone lined up before the next guest arrives.
              </p>
            </div>
          </div>
        </div>

        {/* Connected calendars */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(var(--bark) / 0.4)" }} />
          </div>
        ) : connections.length === 0 ? (
          <div className="rounded-ds-md" style={cardStyle}>
            <EmptyConnections />
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map((conn) => (
              <ConnectionCard
                key={conn.id}
                conn={conn}
                onSync={handleSync}
                onRemove={(id) => removeConnection(id)}
                syncing={syncingId === conn.id}
              />
            ))}
          </div>
        )}

        {/* Add calendar collapsible */}
        <div className="rounded-ds-md overflow-hidden" style={cardStyle}>
          <button
            className="w-full flex items-center justify-between px-4 py-3.5"
            onClick={() => setAddOpen((v) => !v)}
            aria-expanded={addOpen}
            aria-controls="add-calendar-form"
          >
            <div className="flex items-center gap-2">
              <Plus
                className="w-4 h-4"
                style={{ color: "hsl(var(--bark))" }}
              />
              <span
                className="font-display italic font-semibold"
                style={{ fontSize: "0.9rem", color: "hsl(var(--ink-deep))" }}
              >
                Add a calendar
              </span>
            </div>
            {addOpen ? (
              <ChevronUp className="w-4 h-4" style={{ color: "hsl(var(--olivewood) / 0.5)" }} />
            ) : (
              <ChevronDown className="w-4 h-4" style={{ color: "hsl(var(--olivewood) / 0.5)" }} />
            )}
          </button>

          {addOpen && (
            <div id="add-calendar-form" className="px-4 pb-4">
              <AddCalendarForm
                onAdd={(form) => addConnection(form)}
                loading={adding}
              />
            </div>
          )}
        </div>

        {/* Help note */}
        <p
          className="text-center px-2"
          style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.55)" }}
        >
          Helpr fetches your calendar every few hours. Cleaning jobs are created
          for checkouts up to 7 days out. Jobs you created manually are never
          affected.
        </p>
      </div>
    </div>
  );
}
