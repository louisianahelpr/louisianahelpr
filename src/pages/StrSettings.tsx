/**
 * StrSettings — /str-settings
 *
 * "Rental Host Automation" settings page. Lets users connect Airbnb / VRBO
 * iCal feeds so Helpr auto-posts a cleaning job each time a guest checks out.
 *
 * AppShell page (owner, 2026-08-30: "app shell globally"). Chrome stays
 * pinned; content scrolls in AppShell's internal container. Deliberately NOT
 * in DOCUMENT_SCROLL_ROUTES — an AppShell page on that list gets a second
 * scroll lock stacked on its own (iOS double-rubber-band).
 */

import { useState } from "react";

import { CalendarDays, Plus, ChevronDown, X } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppPage from "@/components/AppPage";
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
        // `jobs_created` was computed by the edge function, returned, and
        // never read — the one counter this feature has was dead. A sync that
        // posted three cleaning jobs and a sync that found nothing new looked
        // identical: the only on-screen change was the "last synced" line,
        // and that line only moves if the function's own (unguarded)
        // `last_synced_at` write happened to land.
        // Bare `toast(...)` on purpose — `toast.success` is a no-op app-wide
        // under toastPolicy, so a confirmation written that way renders
        // nothing at all.
        const created = result?.jobs_created ?? 0;
        toast(
          created > 0
            ? `Synced — ${created} cleaning ${created === 1 ? "job" : "jobs"} posted`
            : "Synced — no new checkouts to cover",
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
      const { data, error } = await supabase
        .from("str_calendar_connections")
        .update({ is_active: false })
        .eq("id", connectionId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Couldn't remove that connection — try again?");
      }
    },
    onSuccess: () => {
      setRemovingId(null);
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
    <AppPage title="Host Automation" backTo="/profile">

        {/* ONE card, every breakpoint (owner, 2026-08-29: "merge into 1"). This
            used to stack a desktop-only "How it works" rail ABOVE the
            calendars — a leftover from an old 12-col split whose grid classes
            (`lg:col-span-4` / `lg:col-span-8`) had gone dead the moment the
            parent lost its `grid`, so the two "columns" just stacked as plain
            block siblings: rail card, then empty-state card, both saying the
            same cadence sentence one after another. That sentence already
            lives inside whichever real card is showing (the empty state's
            footnote, or the "Add a Calendar" card's footnote once connections
            exist) — it was `lg:hidden` there specifically to make room for
            the rail's desktop copy. Now that the rail is gone, both footnotes
            below render unconditionally, and the cadence note has exactly one
            home at every width. */}
          <div className="space-y-4">
          {/* Main column: calendars + add + help */}
          <section className="space-y-4 min-w-0">
            {/* Connected calendars */}
            {isLoading ? (
              <div className="flex justify-center py-8">
                <HelprSpinner size={24} />
              </div>
            ) : isError ? (
              <div className="flex">
                <ErrorState
                  variant="inline"
                  title="We couldn't load your calendars."
                  body="Your connected calendars are still saved — we just couldn't reach them. Tap Try again before adding one, so you don't end up with a duplicate."
                  onRetry={() => void refetch()}
                  retryDisabled={isFetching}
                />
              </div>
            ) : showEmptyState ? (
              /* One card for one idea and one action: what this does, and the
                 button that does it. No `surfaceStyle` override (2026-08-30
                 fix): this had been pinned to the page's premium burnt-sienna
                 card material to read as one tier with SubscriptionPage, but
                 that made the FIRST thing a host sees on this page (the empty
                 state — the common case before any calendar is connected) the
                 one screen in the whole Profile sub-page family that isn't
                 the standard near-white `.liquid-glass` surface every other
                 empty state (Messages, My Posts/Jobs, Browse, Home History)
                 uses. Falls back to EmptyState's default liquid-glass now;
                 ConnectionCard and the "Add a Calendar" card below still use
                 `cardStyle`, so the premium treatment stays once a host has
                 actually connected something. */
              <EmptyState
                variant="inline"
                icon={CalendarDays}
                eyebrow="No calendars connected yet"
                title="Never scramble for a cleaner again"
                body="Connect your Airbnb or VRBO calendar. When a guest checks out, Helpr automatically posts a cleaning job — so you always have someone lined up before the next guest arrives."
                action={
                  <BarkPillButton onClick={() => setAddOpen(true)}>
                    <Plus className="w-4 h-4 mr-1.5" />
                    Add a Calendar
                  </BarkPillButton>
                }
                /* Fine print INSIDE the card. This sentence used to print on
                   the bare page background underneath the card, which no other
                   Profile sub-page does — /pets, /family and /home-history all
                   keep their content in the card. Renders at every width now
                   that the desktop rail duplicating it is gone. */
                footnote={
                  <p
                    className="text-ds-12 max-w-[26rem] mx-auto"
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
                  {/* Collapsed: the whole row opens the form (chevron-down).
                      Expanded (2026-08-30 fix): swapped the chevron for an
                      explicit X/Cancel — a chevron that flips to point "up"
                      reads as "collapse this section," which is accurate but
                      easy to miss as a way to back out of adding a calendar;
                      an X is the unambiguous "cancel this" affordance used
                      everywhere else a form/sheet closes in this app (see
                      PetForm's header X). Click target and behavior
                      (toggle addOpen) are unchanged — only the icon/label. */}
                  <button
                    className="w-full flex items-center justify-between px-4 py-3.5"
                    onClick={() => setAddOpen((v) => !v)}
                    aria-expanded={addOpen}
                    aria-controls={addOpen ? "add-calendar-form" : undefined}
                    aria-label={addOpen ? "Cancel adding a calendar" : undefined}
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
                        Add a Calendar
                      </span>
                    </div>
                    {addOpen ? (
                      <span
                        className="inline-flex items-center gap-1 text-ds-12 font-medium"
                        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                      >
                        Cancel
                        <X className="w-4 h-4" />
                      </span>
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
                      stranded on the page background beneath it. */}
                  <p
                    className="px-4 pt-0.5 pb-3.5 text-ds-12"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    {cadenceNote}
                  </p>
                </div>
              </>
            )}
          </section>
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
            : "Remove This Calendar?"
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
        secondaryLabel="Keep Calendar"
      />
    </AppPage>
  );
}
