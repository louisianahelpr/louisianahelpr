import type { PetProfile } from "./types";
import { SPECIES_OPTIONS, speciesEmoji } from "./petProfilesHelpers";

interface PetRailRowProps {
  pet: PetProfile;
  active: boolean;
  onSelect: () => void;
}

/**
 * Compact left-rail row for the split-column desktop layout on /pets.
 * Analogous to a Messages-list row: avatar + name + quick meta, with an
 * active-selection state that mirrors iMessage-style selection.
 */
export function PetRailRow({ pet, active, onSelect }: PetRailRowProps) {
  const speciesLabel = SPECIES_OPTIONS.find((s) => s.value === pet.species)?.label;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-secondary/40"
      style={{
        background: active ? "hsl(var(--bark) / 0.10)" : "transparent",
      }}
    >
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0"
        style={{
          background: active
            ? "hsl(var(--bark) / 0.18)"
            : "hsl(var(--bark) / 0.10)",
        }}
      >
        {speciesEmoji(pet.species)}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className="text-ds-13 font-semibold leading-tight truncate"
          style={{
            color: active ? "hsl(var(--bark))" : "hsl(var(--foreground))",
          }}
        >
          {pet.name}
        </p>
        <p className="text-ds-11 text-muted-foreground truncate leading-tight mt-0.5">
          {speciesLabel}
          {pet.breed ? ` · ${pet.breed}` : ""}
          {pet.age_years != null ? ` · ${pet.age_years}yr` : ""}
        </p>
      </div>
      {pet.is_evacuation_registered && (
        <span
          className="shrink-0 text-ds-9 font-bold uppercase"
          style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.08em" }}
          title="Evacuation registered"
        >
          🛟
        </span>
      )}
    </button>
  );
}
