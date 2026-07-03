import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";
import { speciesEmoji } from "./constants";
import type { PetProfile } from "./types";

interface RegisterPetModalProps {
  ownerId: string;
  onClose: () => void;
  onRegistered: () => void;
}

function RegisterPetModal({ ownerId, onClose, onRegistered }: RegisterPetModalProps) {
  const [notes, setNotes] = useState("");
  const [destination, setDestination] = useState("");
  const [selectedPetId, setSelectedPetId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const { data: pets, isLoading } = useQuery<PetProfile[]>({
    queryKey: ["pet_profiles", ownerId],
    queryFn: async () => {
      const res = await supabase
        .from("pet_profiles")
        .select("id, name, species, breed")
        .eq("owner_id", ownerId);
      if (res.error) {
        if (res.error.code === "PGRST202") return [];
        throw res.error;
      }
      return (res.data ?? []) as unknown as PetProfile[];
    },
  });

  const handleRegister = async () => {
    if (!selectedPetId) {
      toast.error("Please select a pet");
      hapticError();
      return;
    }
    setSaving(true);
    try {
      const res = await supabase.from("evacuation_pets").insert({
        pet_id: selectedPetId,
        owner_id: ownerId,
        destination_address: destination || null,
        notes: notes || null,
        status: "needs_transport",
      });
      if (res.error) {
        if (res.error.code === "PGRST202") {
          toast.info("Evacuation registry is coming online — check back shortly.");
          onClose();
          return;
        }
        throw res.error;
      }
      toast.success("Your pet is registered for evacuation help");
      onRegistered();
      onClose();
    } catch (err) {
      report(err, { tags: { area: "evacuation_pets.insert" } });
      toast.error("Couldn't register — please try again");
      hapticError();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-premium-page overflow-y-auto">
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b"
        style={{ background: "hsl(var(--parchment))", borderColor: "hsl(var(--olivewood) / 0.12)" }}
      >
        <h2 className="font-display font-bold text-ds-18" style={{ color: "hsl(var(--ink-deep))" }}>
          Register pet for transport
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full active:bg-secondary/60 transition-colors text-muted-foreground font-bold text-lg"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="px-4 py-4 space-y-4 pb-safe-nav">
        {/* Select pet */}
        <div>
          <label className="text-ds-13 font-semibold text-foreground block mb-2">Which pet?</label>
          {isLoading ? (
            <Skeleton className="h-10 rounded-ds-md" />
          ) : pets && pets.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {pets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPetId(p.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-ds-13 font-medium transition-all"
                  style={{
                    background:
                      selectedPetId === p.id
                        ? "hsl(var(--burnt-sienna) / 0.15)"
                        : "hsl(var(--olivewood) / 0.06)",
                    color:
                      selectedPetId === p.id
                        ? "hsl(var(--burnt-sienna))"
                        : "hsl(var(--olivewood) / 0.8)",
                    border:
                      selectedPetId === p.id
                        ? "1px solid hsl(var(--burnt-sienna) / 0.30)"
                        : "1px solid transparent",
                  }}
                >
                  {speciesEmoji(p.species)} {p.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-ds-13 text-muted-foreground">
              You haven't added pet profiles yet.{" "}
              <a href="/pets" className="underline font-medium" style={{ color: "hsl(var(--bark))" }}>
                Add one now
              </a>
            </p>
          )}
        </div>

        <div>
          <label htmlFor="evac-destination" className="text-ds-13 font-semibold text-foreground block mb-1">
            Destination (optional)
          </label>
          <input
            id="evac-destination"
            className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
            placeholder="e.g. Baton Rouge, LA or family address"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="evac-notes" className="text-ds-13 font-semibold text-foreground block mb-1">
            Notes for helper (optional)
          </label>
          <textarea
            id="evac-notes"
            rows={3}
            className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none resize-none"
            placeholder="Carrier included, kennel cough, needs medication twice daily…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <Button className="w-full" size="lg" disabled={saving} onClick={handleRegister}>
          {saving ? "Registering…" : "Register for transport"}
        </Button>
      </div>
    </div>
  );
}

export default RegisterPetModal;
