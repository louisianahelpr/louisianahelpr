import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  Stethoscope, AlertTriangle, Phone, Siren,
  UtensilsCrossed, Fingerprint,
} from "lucide-react";
import type { PetProfile } from "./types";
import { SPECIES_OPTIONS, speciesEmoji } from "./petProfilesHelpers";

interface PetCardProps {
  pet: PetProfile;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: (pet: PetProfile) => void;
  onRequestDelete: (pet: PetProfile) => void;
  deletePending: boolean;
}

export function PetCard({
  pet,
  isExpanded,
  onToggle,
  onEdit,
  onRequestDelete,
  deletePending,
}: PetCardProps) {
  return (
    <div
      className="rounded-ds-lg liquid-glass overflow-hidden"
    >
      {/* Header row */}
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-secondary/40 transition-colors"
        onClick={onToggle}
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
          style={{ background: "hsl(var(--bark) / 0.10)" }}
        >
          {speciesEmoji(pet.species)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-ds-14 font-semibold text-foreground leading-tight">{pet.name}</p>
          <p className="text-ds-11 text-muted-foreground truncate">
            {SPECIES_OPTIONS.find((s) => s.value === pet.species)?.label}
            {pet.breed ? ` · ${pet.breed}` : ""}
            {pet.age_years != null ? ` · ${pet.age_years}yr` : ""}
            {pet.is_evacuation_registered && (
              <span
                className="ml-1.5 inline-flex items-center gap-0.5 text-ds-9 font-bold uppercase"
                style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.08em" }}
              >
                🛟 Evac registered
              </span>
            )}
          </p>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground/60 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div
          className="border-t px-4 py-3 space-y-3"
          style={{ borderColor: "hsl(var(--olivewood) / 0.10)" }}
        >
          {/* Trust signals */}
          <div className="flex flex-wrap gap-2">
            {pet.microchip_id && (
              <span className="inline-flex items-center gap-1 text-ds-10 font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--sage) / 0.12)", color: "hsl(var(--sage))" }}>
                <Fingerprint className="w-3 h-3" /> Microchipped
              </span>
            )}
            {pet.vet_name && (
              <span className="inline-flex items-center gap-1 text-ds-10 font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--bark) / 0.10)", color: "hsl(var(--bark))" }}>
                <Stethoscope className="w-3 h-3" /> Vet on file
              </span>
            )}
            {pet.emergency_contact && (
              <span className="inline-flex items-center gap-1 text-ds-10 font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--burnt-sienna) / 0.10)", color: "hsl(var(--burnt-sienna))" }}>
                <Phone className="w-3 h-3" /> Emergency contact
              </span>
            )}
          </div>

          {/* Medical notes */}
          {pet.medical_notes && (
            <div>
              <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <Stethoscope className="w-3 h-3" /> Medical notes
              </p>
              <p className="text-ds-13 text-foreground leading-snug">{pet.medical_notes}</p>
            </div>
          )}

          {/* Behavioral notes */}
          {pet.behavioral_notes && (
            <div>
              <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Behavior
              </p>
              <p className="text-ds-13 text-foreground leading-snug">{pet.behavioral_notes}</p>
            </div>
          )}

          {/* Feeding schedule */}
          {pet.feeding_schedule && (
            <div>
              <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wide mb-0.5 flex items-center gap-1">
                <UtensilsCrossed className="w-3 h-3" /> Feeding
              </p>
              <p className="text-ds-13 text-foreground leading-snug">{pet.feeding_schedule}</p>
            </div>
          )}

          {/* Vet info */}
          {(pet.vet_name || pet.vet_phone) && (
            <div>
              <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                Vet
              </p>
              <p className="text-ds-13 text-foreground leading-snug">
                {[pet.vet_name, pet.vet_phone].filter(Boolean).join(" · ")}
              </p>
            </div>
          )}

          {/* Emergency contact */}
          {pet.emergency_contact && (
            <div>
              <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                Emergency contact
              </p>
              <p className="text-ds-13 text-foreground leading-snug">{pet.emergency_contact}</p>
            </div>
          )}

          {/* Evacuation status */}
          {pet.is_evacuation_registered && (
            <div
              className="flex items-start gap-2 rounded-ds-sm px-3 py-2"
              style={{ background: "hsl(var(--burnt-sienna) / 0.08)", border: "1px solid hsl(var(--burnt-sienna) / 0.20)" }}
            >
              <Siren className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--burnt-sienna))" }} />
              <p className="text-ds-12 leading-snug" style={{ color: "hsl(var(--burnt-sienna))" }}>
                Registered for evacuation transport. Transport helpers can see this pet during declared emergencies.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => onEdit(pet)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/30 hover:bg-destructive/5"
              disabled={deletePending}
              onClick={() => onRequestDelete(pet)}
            >
              Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
