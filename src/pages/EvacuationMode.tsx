/**
 * /evacuation — public emergency page for pet evacuation coordination.
 *
 * No auth required to view the "I can help" list. Auth required to register
 * a pet or take a transport assignment.
 *
 * PGRST202 graceful fallback: if evacuation_pets doesn't exist in production
 * yet (between merge and `supabase db push`), the page renders a static
 * message rather than an error.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Button } from "@/components/ui/button";
import BackButton from "@/components/BackButton";
import PublicLayout from "@/components/marketing/PublicLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";
import {
  Siren, CheckCircle2, Truck, MapPin,
  ChevronRight, PawPrint,
} from "lucide-react";
import RegisterPetModal from "./evacuationMode/RegisterPetModal";
import { STATUS_STEPS, statusMeta, speciesEmoji, type EvacStatus } from "./evacuationMode/constants";
import type { EvacPet } from "./evacuationMode/types";

// ─── Main page ────────────────────────────────────────────────────────────────

const EvacuationMode = () => {
  usePageMeta({
    title: "Pet Evacuation Help — Helpr",
    description:
      "Emergency pet evacuation coordination for Louisiana. Register a pet that needs transport or volunteer to help neighbors evacuate their animals safely.",
    canonical: "https://www.louisianahelpr.com/evacuation",
    ogTitle: "Pet evacuation help — Louisiana Helpr",
    ogDescription:
      "Register a pet that needs transport or volunteer to help during an evacuation.",
  });
  const { user } = useCurrentUser();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const [showRegisterModal, setShowRegisterModal] = useState(false);

  // My registered pets (logged-in owner view)
  const { data: myEvacPets, refetch: refetchMine } = useQuery<EvacPet[]>({
    queryKey: ["evacuation_pets_mine", userId],
    enabled: !!userId,
    queryFn: async () => {
      const res = await supabase
        .from("evacuation_pets")
        .select("*, pet_profiles(name, species, breed)")
        .eq("owner_id", userId!);
      if (res.error) {
        if (res.error.code === "PGRST202") return [];
        throw res.error;
      }
      return (res.data ?? []) as unknown as EvacPet[];
    },
  });

  // Public list of pets needing transport
  const { data: needsTransport, isLoading: loadingTransport } = useQuery<EvacPet[]>({
    queryKey: ["evacuation_pets_public"],
    queryFn: async () => {
      const res = await supabase
        .from("evacuation_pets")
        .select("*, pet_profiles(name, species, breed)")
        .in("status", ["needs_transport", "helper_assigned"])
        .order("created_at", { ascending: true })
        .limit(50);
      if (res.error) {
        if (res.error.code === "PGRST202") return [];
        throw res.error;
      }
      return (res.data ?? []) as unknown as EvacPet[];
    },
  });

  const claimMutation = useMutation({
    mutationFn: async (evacId: string) => {
      if (!userId) throw new Error("Sign in to help");
      const res = await supabase
        .from("evacuation_pets")
        .update({ helper_id: userId, status: "helper_assigned", updated_at: new Date().toISOString() })
        .eq("id", evacId)
        .eq("status", "needs_transport");
      if (res.error) {
        if (res.error.code === "PGRST202") {
          toast.info("Transport registry coming online shortly");
          return;
        }
        throw res.error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["evacuation_pets_public"] });
      toast.success("You've been assigned — the owner will be notified!");
    },
    onError: (err) => {
      report(err, { tags: { area: "evacuation_pets.claim" } });
      toast.error("Couldn't claim this transport — please try again");
      hapticError();
    },
  });

  const statusStep = (status: EvacStatus) => {
    const idx = STATUS_STEPS.findIndex((s) => s.key === status);
    return idx;
  };

  return (
    <PublicLayout>
      {/* Emergency header */}
      <div
        className="px-4 pt-6 pb-5"
        style={{
          background:
            "linear-gradient(135deg, hsl(var(--burnt-sienna) / 0.15), hsl(var(--bark) / 0.08))",
          borderBottom: "1px solid hsl(var(--burnt-sienna) / 0.20)",
        }}
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0">
            <BackButton />
          </div>
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "hsl(var(--burnt-sienna) / 0.15)" }}
          >
            <Siren className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna))" }} />
          </div>
          <div>
            <h1
              className="font-display font-bold text-ds-20 leading-tight"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Pet Evacuation Help
            </h1>
            <p
              className="text-ds-12 font-semibold mt-0.5"
              style={{ color: "hsl(var(--burnt-sienna))" }}
            >
              Hurricane Season Active
            </p>
            <p className="text-ds-12 text-muted-foreground mt-1 leading-snug">
              Louisiana Helpr connects pet owners with volunteer transport Helprs
              during declared emergencies. No charge — community helping community.
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-5">
        {/* CTA row */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              if (!userId) {
                toast.info("Sign in to register your pet for evacuation help");
                return;
              }
              setShowRegisterModal(true);
            }}
            className="flex flex-col items-center gap-1.5 rounded-ds-lg px-3 py-4 text-center active:scale-[0.98] transition-transform"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.10)",
              border: "1px solid hsl(var(--burnt-sienna) / 0.22)",
            }}
          >
            <PawPrint className="w-6 h-6" style={{ color: "hsl(var(--burnt-sienna))" }} />
            <p className="text-ds-13 font-bold leading-tight" style={{ color: "hsl(var(--burnt-sienna))" }}>
              I need help evacuating my pet
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!userId) {
                toast.info("Sign in to offer transport help");
                return;
              }
              // Scroll to the needs-transport list below
              document.getElementById("needs-transport-list")?.scrollIntoView({ behavior: "smooth" });
            }}
            className="flex flex-col items-center gap-1.5 rounded-ds-lg px-3 py-4 text-center active:scale-[0.98] transition-transform"
            style={{
              background: "hsl(var(--bark) / 0.09)",
              border: "1px solid hsl(var(--bark) / 0.20)",
            }}
          >
            <Truck className="w-6 h-6" style={{ color: "hsl(var(--bark))" }} />
            <p className="text-ds-13 font-bold leading-tight" style={{ color: "hsl(var(--bark))" }}>
              I can help transport pets
            </p>
          </button>
        </div>

        {/* My pets section — logged-in owners */}
        {userId && myEvacPets && myEvacPets.length > 0 && (
          <section>
            <h2
              className="font-serif italic uppercase text-ds-9 mb-3"
              style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
            >
              My pets registered for transport
            </h2>
            <div className="space-y-2">
              {myEvacPets.map((ep) => {
                const meta = statusMeta(ep.status);
                const currentStep = statusStep(ep.status as EvacStatus);
                return (
                  <div
                    key={ep.id}
                    className="rounded-ds-lg liquid-glass overflow-hidden"
                  >
                    <div className="px-4 py-3 flex items-start gap-3">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0"
                        style={{ background: "hsl(var(--bark) / 0.10)" }}
                      >
                        {ep.pet_profiles ? speciesEmoji(ep.pet_profiles.species) : "🐾"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-ds-14 font-semibold text-foreground">
                          {ep.pet_profiles?.name ?? "Pet"}
                        </p>
                        {ep.pet_profiles?.breed && (
                          <p className="text-ds-11 text-muted-foreground">{ep.pet_profiles.breed}</p>
                        )}
                        <div
                          className="inline-flex items-center gap-1 text-ds-10 font-bold uppercase mt-1 px-2 py-0.5 rounded-full"
                          style={{ background: `${meta.color}22`, color: meta.color, letterSpacing: "0.06em" }}
                        >
                          <meta.icon className="w-2.5 h-2.5" />
                          {meta.label}
                        </div>
                      </div>
                    </div>

                    {/* Status progress bar */}
                    <div className="px-4 pb-3">
                      <div className="flex items-center gap-1">
                        {STATUS_STEPS.map((step, i) => (
                          <div
                            key={step.key}
                            className="flex-1 h-1.5 rounded-full"
                            style={{
                              background:
                                i <= currentStep
                                  ? step.color
                                  : "hsl(var(--olivewood) / 0.15)",
                            }}
                          />
                        ))}
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-ds-9 text-muted-foreground">Needs transport</span>
                        <span className="text-ds-9 text-muted-foreground">Reunited</span>
                      </div>
                    </div>

                    {ep.notes && (
                      <div
                        className="px-4 pb-3"
                        style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.08)" }}
                      >
                        <p className="text-ds-11 text-muted-foreground mt-2">{ep.notes}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Helpers: needs-transport list */}
        <section id="needs-transport-list">
          <h2
            className="font-serif italic uppercase text-ds-9 mb-3"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
          >
            Pets needing transport
          </h2>

          {loadingTransport && (
            <div className="space-y-2">
              {[1, 2, 3].map((n) => (
                <Skeleton key={n} className="rounded-ds-lg h-16" />
              ))}
            </div>
          )}

          {!loadingTransport && needsTransport?.length === 0 && (
            <div
              className="rounded-ds-lg liquid-glass px-4 py-5 text-center"
            >
              <CheckCircle2
                className="w-8 h-8 mx-auto mb-2"
                style={{ color: "hsl(var(--sage))" }}
              />
              <p className="text-ds-14 font-semibold text-foreground">All pets accounted for</p>
              <p className="text-ds-12 text-muted-foreground mt-0.5">
                No pets are currently waiting for transport. Check back if conditions change.
              </p>
            </div>
          )}

          {!loadingTransport && (needsTransport ?? []).length > 0 && (
            <div className="space-y-2">
              {(needsTransport ?? []).map((ep) => {
                const meta = statusMeta(ep.status);
                const alreadyAssigned = ep.status === "helper_assigned";
                const isMyAssignment = ep.helper_id === userId;
                return (
                  <div
                    key={ep.id}
                    className="rounded-ds-lg liquid-glass overflow-hidden"
                  >
                    <div className="px-4 py-3 flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0"
                        style={{ background: "hsl(var(--bark) / 0.10)" }}
                      >
                        {ep.pet_profiles ? speciesEmoji(ep.pet_profiles.species) : "🐾"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-ds-14 font-semibold text-foreground">
                          {ep.pet_profiles?.name ?? "Pet"}{" "}
                          {ep.pet_profiles?.species
                            ? `(${ep.pet_profiles.species})`
                            : ""}
                        </p>
                        {ep.pet_profiles?.breed && (
                          <p className="text-ds-11 text-muted-foreground">{ep.pet_profiles.breed}</p>
                        )}
                        {ep.destination_address && (
                          <p className="text-ds-11 text-muted-foreground flex items-center gap-0.5 mt-0.5">
                            <MapPin className="w-2.5 h-2.5 shrink-0" />
                            {ep.destination_address}
                          </p>
                        )}
                        <div
                          className="inline-flex items-center gap-1 text-ds-9 font-bold uppercase mt-1 px-1.5 py-0.5 rounded-full"
                          style={{ background: `${meta.color}22`, color: meta.color, letterSpacing: "0.06em" }}
                        >
                          <meta.icon className="w-2.5 h-2.5" />
                          {meta.label}
                        </div>
                      </div>
                      {!alreadyAssigned && userId && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={claimMutation.isPending}
                          onClick={() => claimMutation.mutate(ep.id)}
                          className="shrink-0"
                          style={{ borderColor: "hsl(var(--bark) / 0.30)", color: "hsl(var(--bark))" }}
                        >
                          Help
                        </Button>
                      )}
                      {alreadyAssigned && isMyAssignment && (
                        <span className="text-ds-10 font-bold text-muted-foreground shrink-0">Your run</span>
                      )}
                      {alreadyAssigned && !isMyAssignment && (
                        <span className="text-ds-10 font-bold text-muted-foreground shrink-0">Covered</span>
                      )}
                    </div>

                    {ep.notes && (
                      <div
                        className="px-4 pb-2.5"
                        style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.08)" }}
                      >
                        <p className="text-ds-11 text-muted-foreground mt-2">{ep.notes}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Info block */}
        <div
          className="rounded-ds-lg px-4 py-3"
          style={{
            background: "hsl(var(--olivewood) / 0.05)",
            border: "1px solid hsl(var(--olivewood) / 0.12)",
          }}
        >
          <p className="text-ds-12 text-muted-foreground leading-snug">
            <span className="font-semibold text-foreground">How it works:</span>{" "}
            Pet owners register their animals and a destination. Volunteer Helprs claim
            transport runs and update the status. All coordination is community-driven and
            free of charge during declared emergencies.
          </p>
          {!userId && (
            <a
              href="/login"
              className="mt-2 inline-flex items-center gap-1 text-ds-12 font-semibold"
              style={{ color: "hsl(var(--bark))" }}
            >
              Sign in to register or help <ChevronRight className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {showRegisterModal && userId && (
        <RegisterPetModal
          ownerId={userId}
          onClose={() => setShowRegisterModal(false)}
          onRegistered={() => {
            queryClient.invalidateQueries({ queryKey: ["evacuation_pets_mine", userId] });
            refetchMine();
          }}
        />
      )}
    </PublicLayout>
  );
};

export default EvacuationMode;
