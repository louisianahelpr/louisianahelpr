/**
 * PetReportCard — helper-facing sheet to send a daily update for a pet job,
 * and owner-facing card to display an incoming report.
 *
 * The insert path gracefully handles PGRST202 (pet_report_cards table not yet
 * deployed to production) so the feature doesn't hard-break between merge and
 * `supabase db push`.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import {
  X, ClipboardList, CheckCircle2, Footprints, Dog,
  Laugh, Smile, Frown, Zap, Moon,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type PetProfile = Database["public"]["Tables"]["pet_profiles"]["Row"];
type ReportCard = Database["public"]["Tables"]["pet_report_cards"]["Row"];

// ─── Mood options ─────────────────────────────────────────────────────────────

const MOODS = [
  { value: "happy", label: "Happy", icon: Laugh, color: "hsl(var(--bark))" },
  { value: "playful", label: "Playful", icon: Zap, color: "hsl(var(--burnt-sienna))" },
  { value: "calm", label: "Calm", icon: Smile, color: "hsl(var(--sage))" },
  { value: "tired", label: "Tired", icon: Moon, color: "hsl(var(--olivewood) / 0.8)" },
  { value: "anxious", label: "Anxious", icon: Frown, color: "hsl(var(--burnt-sienna))" },
] as const;

// ─── Helper-side report card form ─────────────────────────────────────────────

interface SendReportCardProps {
  jobId: string;
  helperId: string;
  ownerId: string;
  onClose: () => void;
}

export function SendReportCard({
  jobId,
  helperId,
  ownerId,
  onClose,
}: SendReportCardProps) {
  const queryClient = useQueryClient();

  // Load pets belonging to this owner so the helper can select which pet
  // they're filing for. PGRST202 graceful fallback: if the table doesn't
  // exist yet in production, silently treat pets as empty.
  const { data: pets, isLoading: petsLoading } = useQuery<PetProfile[]>({
    queryKey: ["pet_profiles_for_job", ownerId],
    queryFn: async () => {
      const res = await supabase
        .from("pet_profiles")
        .select("id, name, species")
        .eq("owner_id", ownerId);
      if (res.error) {
        if (res.error.code === "PGRST202") return [];
        throw res.error;
      }
      return (res.data ?? []) as unknown as PetProfile[];
    },
  });

  const [petId, setPetId] = useState<string>("");
  const [ateWell, setAteWell] = useState<boolean | null>(null);
  const [exerciseMinutes, setExerciseMinutes] = useState<string>("");
  const [pottyBreaks, setPottyBreaks] = useState<string>("");
  const [mood, setMood] = useState<string>("");
  const [walkSummary, setWalkSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!petId) {
      toast.error("Pick which pet this report is for");
      hapticError();
      return;
    }

    // Find the pet name so we can personalise the notification
    const pet = pets?.find((p) => p.id === petId);
    const petName = pet?.name ?? "Your pet";

    setSaving(true);
    try {
      const insertRes = await supabase.from("pet_report_cards").insert({
        job_id: jobId,
        pet_id: petId,
        helper_id: helperId,
        owner_id: ownerId,
        ate_well: ateWell,
        exercise_duration_minutes: exerciseMinutes
          ? parseInt(exerciseMinutes, 10)
          : null,
        potty_breaks: pottyBreaks ? parseInt(pottyBreaks, 10) : null,
        mood: mood || null,
        notes: notes || null,
        gps_walk_summary: walkSummary || null,
      });

      if (insertRes.error) {
        // PGRST202 = table not yet in production; degrade gracefully
        if (insertRes.error.code === "PGRST202") {
          toast("Pet report cards are on the way — we'll notify you when they launch!");
          onClose();
          return;
        }
        throw insertRes.error;
      }

      // Notify the owner
      await createNotification({
        user_id: ownerId,
        title: `${petName}'s report card is ready`,
        message: `Your Helpr sent a daily update — check ${petName}'s activity, mood, and notes.`,
        type: "info",
        link: "/my-posts",
      });

      hapticSuccess();
      toast.success(`Report card sent for ${petName}!`);
      queryClient.invalidateQueries({ queryKey: ["pet_report_cards", jobId] });
      onClose();
    } catch (err) {
      report(err, { tags: { area: "pet_report_cards.insert" } });
      toast.error("Couldn't send the report card — please try again");
      hapticError();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-premium-page overflow-y-auto"
      // Same full-screen-overlay top inset as PetForm — see the note there.
      style={{ paddingTop: "var(--safe-area-top, 0px)" }}
    >
      {/* Header */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b"
        style={{ background: "hsl(var(--parchment))", borderColor: "hsl(var(--olivewood) / 0.12)" }}
      >
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
          <h2
            className="font-display font-bold text-ds-18"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Send report card
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full active:bg-secondary/60 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      <div className="px-4 py-4 space-y-5 pb-safe-nav">
        {/* Pet selector */}
        <section>
          <h3
            className="font-serif italic uppercase text-ds-9 mb-3"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
          >
            Which pet?
          </h3>
          {petsLoading ? (
            <div className="rounded-ds-lg liquid-glass h-12 motion-safe:animate-pulse" />
          ) : pets && pets.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {pets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPetId(p.id)}
                  className="px-3 py-1.5 rounded-ds-md text-ds-13 font-medium transition-all"
                  style={{
                    background:
                      petId === p.id
                        ? "hsl(var(--bark) / 0.15)"
                        : "hsl(var(--olivewood) / 0.06)",
                    color:
                      petId === p.id
                        ? "hsl(var(--bark))"
                        : "hsl(var(--olivewood) / 0.8)",
                    border:
                      petId === p.id
                        ? "1px solid hsl(var(--bark) / 0.35)"
                        : "1px solid transparent",
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-ds-13 text-muted-foreground">
              The owner hasn't added pet profiles yet — you can still send a general note.
            </p>
          )}
        </section>

        {/* Ate well */}
        <section>
          <h3
            className="font-serif italic uppercase text-ds-9 mb-3"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
          >
            Ate their food?
          </h3>
          <div className="flex gap-2">
            {([
              { val: true, label: "Yes, ate well" },
              { val: false, label: "Skipped food" },
            ] as const).map(({ val, label }) => (
              <button
                key={String(val)}
                type="button"
                onClick={() => setAteWell(val)}
                className="flex-1 py-2 rounded-ds-md text-ds-13 font-medium transition-all"
                style={{
                  background:
                    ateWell === val
                      ? val
                        ? "hsl(var(--bark) / 0.15)"
                        : "hsl(var(--burnt-sienna) / 0.12)"
                      : "hsl(var(--olivewood) / 0.06)",
                  color:
                    ateWell === val
                      ? val
                        ? "hsl(var(--bark))"
                        : "hsl(var(--burnt-sienna))"
                      : "hsl(var(--olivewood) / 0.8)",
                  border: ateWell === val
                    ? `1px solid ${val ? "hsl(var(--bark) / 0.30)" : "hsl(var(--burnt-sienna) / 0.30)"}`
                    : "1px solid transparent",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Mood */}
        <section>
          <h3
            className="font-serif italic uppercase text-ds-9 mb-3"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
          >
            Mood today
          </h3>
          <div className="flex gap-2 flex-wrap">
            {MOODS.map(({ value, label, icon: Icon, color }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMood(value)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-ds-md text-ds-12 font-medium transition-all"
                style={{
                  background:
                    mood === value ? `${color}22` : "hsl(var(--olivewood) / 0.06)",
                  color: mood === value ? color : "hsl(var(--olivewood) / 0.8)",
                  border:
                    mood === value
                      ? `1px solid ${color}55`
                      : "1px solid transparent",
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Stats */}
        <section>
          <h3
            className="font-serif italic uppercase text-ds-9 mb-3"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
          >
            Activity stats
          </h3>
          <div className="rounded-ds-lg liquid-glass overflow-hidden px-4 py-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-ds-11 text-muted-foreground block mb-1 flex items-center gap-1">
                  <Footprints className="w-3 h-3" /> Exercise (min)
                </label>
                <input
                  type="number"
                  min={0}
                  aria-label="Exercise in minutes"
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  value={exerciseMinutes}
                  onChange={(e) => setExerciseMinutes(e.target.value)}
                />
              </div>
              <div>
                <label className="text-ds-11 text-muted-foreground block mb-1 flex items-center gap-1">
                  <Dog className="w-3 h-3" /> Potty breaks
                </label>
                <input
                  type="number"
                  min={0}
                  aria-label="Number of potty breaks"
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  value={pottyBreaks}
                  onChange={(e) => setPottyBreaks(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-ds-11 text-muted-foreground block mb-1">
                Walk summary (optional)
              </label>
              <input
                aria-label="Walk summary (optional)"
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                value={walkSummary}
                onChange={(e) => setWalkSummary(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Notes */}
        <section>
          <h3
            className="font-serif italic uppercase text-ds-9 mb-3"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
          >
            Notes for the owner
          </h3>
          <textarea
            rows={3}
            aria-label="Notes for the owner"
            className="glass-field w-full rounded-ds-lg px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none resize-none"
            placeholder="Anything the owner should know about today's visit…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </section>

        <Button className="w-full" size="lg" disabled={saving} onClick={handleSubmit}>
          {saving ? "Sending…" : "Send report card"}
        </Button>
      </div>
    </div>
  );
}

// ─── Owner-side incoming report card display ──────────────────────────────────

interface IncomingReportCardProps {
  jobId: string;
}

export function IncomingReportCard({ jobId }: IncomingReportCardProps) {
  const { data: cards, isLoading } = useQuery<ReportCard[]>({
    queryKey: ["pet_report_cards", jobId],
    queryFn: async () => {
      const res = await supabase
        .from("pet_report_cards")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false });
      if (res.error) {
        if (res.error.code === "PGRST202") return [];
        throw res.error;
      }
      return (res.data ?? []) as unknown as ReportCard[];
    },
  });

  if (isLoading || !cards?.length) return null;

  const card = cards[0];
  const moodOption = MOODS.find((m) => m.value === card.mood);

  return (
    <div
      className="rounded-ds-md overflow-hidden border"
      style={{ borderColor: "hsl(var(--bark) / 0.20)" }}
    >
      {/* Header */}
      <div
        className="px-3 py-2 flex items-center gap-2"
        style={{ background: "hsl(var(--bark) / 0.07)" }}
      >
        <ClipboardList className="w-3.5 h-3.5" style={{ color: "hsl(var(--bark))" }} />
        <p className="text-ds-12 font-semibold" style={{ color: "hsl(var(--bark))" }}>
          Report card sent
        </p>
        <span className="ml-auto text-ds-10 text-muted-foreground">
          {new Date(card.created_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>

      <div className="px-3 py-2.5 space-y-2">
        {/* Quick stats row */}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {card.ate_well !== null && (
            <span className="text-ds-11 flex items-center gap-1">
              <CheckCircle2
                className="w-3 h-3"
                style={{ color: card.ate_well ? "hsl(var(--bark))" : "hsl(var(--burnt-sienna))" }}
              />
              <span style={{ color: card.ate_well ? "hsl(var(--bark))" : "hsl(var(--burnt-sienna))" }}>
                {card.ate_well ? "Ate well" : "Skipped food"}
              </span>
            </span>
          )}
          {card.exercise_duration_minutes != null && (
            <span className="text-ds-11 text-muted-foreground flex items-center gap-1">
              <Footprints className="w-3 h-3" />
              {card.exercise_duration_minutes} min exercise
            </span>
          )}
          {card.potty_breaks != null && (
            <span className="text-ds-11 text-muted-foreground flex items-center gap-1">
              <Dog className="w-3 h-3" />
              {card.potty_breaks} potty {card.potty_breaks === 1 ? "break" : "breaks"}
            </span>
          )}
          {moodOption && (
            <span
              className="text-ds-11 font-medium flex items-center gap-1"
              style={{ color: moodOption.color }}
            >
              <moodOption.icon className="w-3 h-3" />
              {moodOption.label}
            </span>
          )}
        </div>

        {card.gps_walk_summary && (
          <p className="text-ds-11 text-muted-foreground">
            🗺 {card.gps_walk_summary}
          </p>
        )}

        {card.notes && (
          <p className="text-ds-12 text-foreground leading-snug">{card.notes}</p>
        )}

        {cards.length > 1 && (
          <p className="text-ds-10 text-muted-foreground">
            +{cards.length - 1} more {cards.length - 1 === 1 ? "report" : "reports"} this job
          </p>
        )}
      </div>
    </div>
  );
}
