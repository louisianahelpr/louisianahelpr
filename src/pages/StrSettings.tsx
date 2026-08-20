/**
 * StrSettings — /str-settings
 *
 * "Rental Host Automation" settings page. Lets users connect Airbnb / VRBO
 * iCal feeds so Helpr auto-posts a cleaning job each time a guest checks out.
 *
 * Document-scroll page (listed in DOCUMENT_SCROLL_ROUTES). Uses the canonical
 * PageHeader + min-h-screen wrapper — same pattern as PayItForward.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Home, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import type { AddFormState, StrConnection } from "./strSettings/types";
import { cardStyle } from "./strSettings/strSettingsHelpers";
import { ConnectionCard } from "./strSettings/ConnectionCard";
import { AddCalendarForm, validateCleaningBudget } from "./strSettings/AddCalendarForm";

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function StrSettings() {
  usePageTitle("Host Automation — Helpr");
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Connection pending removal — gates the destructive action behind a
  // branded confirm, same as PetProfiles and FamilyDashboard do for theirs.
  const [connToRemove, setConnToRemove] = useState<StrConnection | null>(null);
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  // ── Fetch connections ────────────────────────────────────────────────────
  // isError/isFetching are load-bearing, not decoration: on a failed fetch
  // `connections` falls back to [] and the page would otherwise render
  // "No calendars connected yet" — telling a host their calendars are gone
  // and inviting them to re-add a duplicate feed. Error must read as error.
  const { data: connections = [], isLoading, isError, isFetching, refetch } = useQuery({
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

      // This budget is the flat dollar amount every auto-posted cleaning job
      // will be created with, so it must be the host's OWN number. The old
      // `parseFloat(...) || 80` silently turned "", "abc" or "0" into $80 and
      // accepted "5" despite the input advertising a $10 minimum — a host
      // could end up committing to a price they never chose. Refuse the save
      // with the same message the form shows instead.
      const budgetCheck = validateCleaningBudget(form.cleaning_budget);
      if (form.auto_create_cleaning && budgetCheck.error) {
        throw new Error(budgetCheck.error);
      }

      const { data, error } = await supabase
        .from("str_calendar_connections")
        .insert({
          user_id: user.id,
          platform: form.platform,
          ical_url: form.ical_url.trim().replace(/^webcal:/, "https:"),
          property_name: form.property_name.trim() || null,
          property_address: form.property_address.trim() || null,
          auto_create_cleaning: form.auto_create_cleaning,
          // Omitted (→ column default) only when auto-create is OFF and the
          // hidden field holds nothing usable; never overwritten with a
          // made-up number when the host did type one.
          ...(budgetCheck.value !== null ? { cleaning_budget: budgetCheck.value } : {}),
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
      toast.error(err.message ?? "Couldn't connect your calendar — try again?");
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

      if (!res.ok) throw new Error(`Couldn't sync your calendar (${res.status}) — try again?`);
      const body = await res.json() as { results?: Array<{ jobs_created?: number; error?: string }> };
      const result = body.results?.[0];

      if (result?.error) {
        toast.error(`Couldn't sync — ${result.error}`);
      } else {
        const n = result?.jobs_created ?? 0;
        toast.success(
          n > 0
            ? `Sync complete — ${n} cleaning job${n === 1 ? "" : "s"} created`
            : "Sync complete — no new checkouts in the next 7 days",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't sync your calendar — try again?");
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
      setRemovingId(null);
      toast.success("Calendar removed");
      queryClient.invalidateQueries({ queryKey: ["str-calendar-connections"] });
    },
    onError: () => {
      setRemovingId(null);
      toast.error("Couldn't remove that calendar — try again?");
    },
  });

  // ── Render ────────────────────────────────────────────────────────────────
  // The empty state OWNS the "Add a calendar" call to action, so the separate
  // collapsible row underneath it would be the same invitation twice (and was
  // why the old empty copy had to point "below"). Show one or the other: the
  // empty card until the host asks to add, the form from then on.
  const showEmptyState = !isLoading && !isError && connections.length === 0 && !addOpen;

  // Factual cadence copy — verbatim in both places it renders (desktop rail /
  // mobile footnote). Only one of the two is ever on screen.
  const cadenceNote =
    "Helpr fetches your calendar every few hours. Cleaning jobs are created " +
    "for checkouts up to 7 days out. Jobs you created manually are never " +
    "affected.";

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      {/* Geometry is the CANONICAL Profile sub-screen ladder, shared verbatim
          with the Profile tab bodies (Profile.tsx) and PageHeader's `default`
          width: max-w-5xl → lg:6xl → xl:7xl → 2xl:90rem on px-5 → lg:px-8 →
          xl:px-12. This page used to run its own max-w-lg/px-4 ladder, and
          shipped with NO back target at all — it is reached from the Profile
          landing, so the chevron goes back there like every sibling. */}
      <PageHeader
        title="Host Automation"
        onBack={() => navigate("/profile")}
      />

      <div className="max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto px-5 lg:px-8 xl:px-12 pt-4 pb-8">

        <div className="lg:grid lg:grid-cols-12 lg:gap-8 lg:items-start">
          {/* Desktop-only left rail.
              This used to repeat the "Never scramble for a cleaner again"
              pitch that the empty state below already makes — the same two
              sentences twice on one screen. The pitch now lives once, in the
              empty state; the rail carries the mechanics instead, which are
              the thing a host still wants once calendars ARE connected and
              the pitch has done its job. */}
          <aside className="hidden lg:block lg:col-span-4">
            <div className="rounded-ds-md p-5 lg:sticky lg:top-6" style={cardStyle}>
              <div
                className="rounded-full flex items-center justify-center mb-3"
                style={{
                  width: 44, height: 44,
                  background: "hsl(var(--burnt-sienna) / 0.12)",
                  border: "1.5px solid hsl(var(--burnt-sienna) / 0.3)",
                }}
              >
                <Home className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} />
              </div>
              <p
                className="font-display italic font-bold text-ds-18"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                How it works
              </p>
              <p
                className="mt-2 text-ds-14"
                style={{ color: "hsl(var(--olivewood) / 0.85)", lineHeight: 1.55 }}
              >
                {cadenceNote}
              </p>
            </div>
          </aside>

          {/* Main column: calendars + add + help */}
          <section className="lg:col-span-8 space-y-4 min-w-0">
            {/* Connected calendars */}
            {isLoading ? (
              <div className="flex justify-center py-8">
                <HelprSpinner size={24} />
              </div>
            ) : isError ? (
              <div className="flex">
                <ErrorState
                  variant="inline"
                  title="Couldn't load your calendars."
                  body="Your connected calendars are still saved — we just couldn't reach them. Tap Try again before adding one, so you don't end up with a duplicate."
                  onRetry={() => void refetch()}
                  retryDisabled={isFetching}
                />
              </div>
            ) : showEmptyState ? (
              /* One card for one idea and one action: what this does, and the
                 button that does it. `surfaceStyle` keeps the page's premium
                 card material rather than dropping a white glass tile into it. */
              <EmptyState
                variant="inline"
                /* 14px = tailwind `rounded-ds-md`, the radius every other card
                   on this page carries; the shared card is `rounded-2xl`. */
                surfaceStyle={{ ...cardStyle, borderRadius: 14 }}
                icon={CalendarDays}
                eyebrow="No calendars connected yet"
                title="Never scramble for a cleaner again"
                body="Connect your Airbnb or VRBO calendar. When a guest checks out, Helpr automatically posts a cleaning job — so you always have someone lined up before the next guest arrives."
                action={
                  <BarkPillButton onClick={() => setAddOpen(true)}>
                    <Plus className="w-4 h-4 mr-1.5" />
                    Add a calendar
                  </BarkPillButton>
                }
                /* Fine print INSIDE the card. This sentence used to print on
                   the bare page background underneath the card, which no other
                   Profile sub-page does — /pets, /family and /home-history all
                   keep their content in the card. `lg:hidden` because the
                   desktop rail carries the same sentences at lg+. */
                footnote={
                  <p
                    className="lg:hidden text-ds-12 max-w-[26rem] mx-auto"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    {cadenceNote}
                  </p>
                }
              />
            ) : (
              <>
                {connections.length > 0 && (
                  <div className="space-y-3">
                    {connections.map((conn) => (
                      <ConnectionCard
                        key={conn.id}
                        conn={conn}
                        onSync={handleSync}
                        onRequestRemove={setConnToRemove}
                        syncing={syncingId === conn.id}
                        removing={removingId === conn.id}
                      />
                    ))}
                  </div>
                )}

                {/* Add calendar collapsible. Collapsing it with no calendars
                    connected hands the screen back to the empty state, so the
                    host is never left staring at a lone closed row. */}
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
                        className="font-display italic font-semibold text-ds-14"
                        style={{ color: "hsl(var(--ink-deep))" }}
                      >
                        Add a calendar
                      </span>
                    </div>
                    {addOpen ? (
                      <ChevronUp className="w-4 h-4" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
                    ) : (
                      <ChevronDown className="w-4 h-4" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
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

                  {/* Same fine print as the empty state's, in the same place
                      relative to the content: inside the last card rather than
                      stranded on the page background beneath it. The desktop
                      rail carries these sentences at lg+, so only one of the
                      two is ever on screen. */}
                  <p
                    className="lg:hidden px-4 pt-0.5 pb-3.5 text-ds-12"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    {cadenceNote}
                  </p>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {/* Removing is a soft-delete (`is_active: false`) and there is no
          archived view, so from the host's side it is permanent — the confirm
          copy says so rather than implying it can be undone. Confirming closes
          this dialog; the card's own trash button takes over the pending
          spinner while the mutation runs. */}
      <BrandConfirmDialog
        open={connToRemove !== null}
        onOpenChange={(open) => { if (!open) setConnToRemove(null); }}
        title={
          connToRemove
            ? `Remove ${connToRemove.property_name || "this calendar"}?`
            : "Remove this calendar?"
        }
        description="Helpr will stop syncing it and won't post any more cleaning jobs from it. Cleaning jobs already posted stay exactly as they are."
        callout={{
          text: "This can't be undone — you'd have to paste the calendar URL in again to reconnect.",
        }}
        primaryLabel="Remove"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => {
          if (!connToRemove) return;
          setRemovingId(connToRemove.id);
          removeConnection(connToRemove.id);
          setConnToRemove(null);
        }}
        secondaryLabel="Keep calendar"
      />
    </div>
  );
}
