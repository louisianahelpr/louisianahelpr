import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Stethoscope, AlertTriangle, Phone,
  UtensilsCrossed, Fingerprint,
} from "lucide-react";
import type { PetProfile } from "./types";
import { SPECIES_OPTIONS, speciesEmoji } from "./petProfilesHelpers";
import { PetForm } from "./PetForm";

interface PetDetailProps {
  pet: PetProfile;
  ownerId: string;
  onSaved: () => void;
  onRequestDelete: (pet: PetProfile) => void;
  deletePending: boolean;
}

/**
 * Full detail view for the split-column desktop right pane. Renders the
 * pet's care details, and swaps to an inline PetForm when the user clicks
 * "Edit" (mirroring iMessage-style in-pane editing rather than opening a
 * modal on top of it).
 */
export function PetDetail({
  pet,
  ownerId,
  onSaved,
  onRequestDelete,
  deletePending,
}: PetDetailProps) {
  const [editing, setEditing] = useState(false);

  // If the caller switches which pet is active, exit edit mode so the new
  // pet isn't inadvertently shown inside a form primed with the previous
  // one's values (PetForm keys on this via `key={pet.id}` from the parent).
  useEffect(() => {
    setEditing(false);
  }, [pet.id]);

  if (editing) {
    return (
      <PetForm
        variant="inline"
        initialValues={pet}
        ownerId={ownerId}
        onClose={() => setEditing(false)}
        onSaved={() => {
          onSaved();
          setEditing(false);
        }}
      />
    );
  }

  const speciesLabel = SPECIES_OPTIONS.find((s) => s.value === pet.species)?.label;

  return (
    <div className="rounded-ds-lg liquid-glass overflow-hidden">
      {/* Header — big avatar + name + species/breed/age */}
      <div
        className="px-6 py-5 border-b flex items-start gap-4"
        style={{ borderColor: "hsl(var(--olivewood) / 0.10)" }}
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-4xl shrink-0"
          style={{ background: "hsl(var(--bark) / 0.10)" }}
        >
          {speciesEmoji(pet.species)}
        </div>
        <div className="flex-1 min-w-0">
          <h2
            className="font-display font-bold text-ds-22 leading-tight"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            {pet.name}
          </h2>
          <p className="text-ds-13 text-muted-foreground leading-snug mt-1">
            {speciesLabel}
            {pet.breed ? ` · ${pet.breed}` : ""}
            {pet.age_years != null ? ` · ${pet.age_years}yr` : ""}
            {pet.weight_lbs != null ? ` · ${pet.weight_lbs} lbs` : ""}
          </p>
          {pet.color_markings && (
            <p className="text-ds-12 text-muted-foreground leading-snug mt-0.5">
              {pet.color_markings}
            </p>
          )}
        </div>
        <div className="hidden sm:flex gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
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

      {/* Body */}
      <div className="px-6 py-5 space-y-5">
        {/* Trust signals */}
        {(pet.microchip_id || pet.vet_name || pet.emergency_contact) && (
          <div className="flex flex-wrap gap-2">
            {pet.microchip_id && (
              <span className="inline-flex items-center gap-1 text-ds-10 font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--sage) / 0.12)", color: "hsl(var(--sage-ink))" }}>
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
        )}

        {/* Medical notes */}
        {pet.medical_notes && (
          <DetailBlock icon={Stethoscope} label="Medical notes">
            {pet.medical_notes}
          </DetailBlock>
        )}

        {/* Behavioral notes */}
        {pet.behavioral_notes && (
          <DetailBlock icon={AlertTriangle} label="Behavior">
            {pet.behavioral_notes}
          </DetailBlock>
        )}

        {/* Feeding schedule */}
        {pet.feeding_schedule && (
          <DetailBlock icon={UtensilsCrossed} label="Feeding">
            {pet.feeding_schedule}
          </DetailBlock>
        )}

        {/* Vet info */}
        {(pet.vet_name || pet.vet_phone) && (
          <DetailBlock label="Vet">
            {[pet.vet_name, pet.vet_phone].filter(Boolean).join(" · ")}
          </DetailBlock>
        )}

        {/* Microchip */}
        {pet.microchip_id && (
          <DetailBlock label="Microchip ID">
            {pet.microchip_id}
          </DetailBlock>
        )}

        {/* Emergency contact */}
        {pet.emergency_contact && (
          <DetailBlock label="Emergency contact">
            {pet.emergency_contact}
          </DetailBlock>
        )}

        {/* When there's nothing to show, gently prompt the user to fill it out */}
        {!pet.medical_notes &&
          !pet.behavioral_notes &&
          !pet.feeding_schedule &&
          !pet.vet_name && !pet.vet_phone &&
          !pet.emergency_contact &&
          !pet.microchip_id && (
            <p className="text-ds-12 text-muted-foreground italic">
              No care details yet. Tap Edit to add feeding, medical notes,
              and a vet — the more your Helpr knows, the better.
            </p>
          )}

        {/* Mobile-collapsed actions (in case detail is ever rendered at
            <sm) — desktop header hosts them at ≥sm. */}
        <div className="flex gap-2 pt-2 sm:hidden">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => setEditing(true)}
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
    </div>
  );
}

// ─── Local helpers ─────────────────────────────────────────────────────────

interface DetailBlockProps {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}

function DetailBlock({ icon: Icon, label, children }: DetailBlockProps) {
  return (
    <div>
      <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wide mb-0.5 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </p>
      <p className="text-ds-13 text-foreground leading-snug whitespace-pre-wrap">
        {children}
      </p>
    </div>
  );
}
