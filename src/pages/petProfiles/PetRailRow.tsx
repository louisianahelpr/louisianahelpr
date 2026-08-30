import { Pencil, Trash2 } from "lucide-react";
import type { PetProfile } from "./types";
import { SPECIES_OPTIONS, speciesEmoji } from "./petProfilesHelpers";

interface PetRailRowProps {
  pet: PetProfile;
  active: boolean;
  onSelect: () => void;
  /** Open this pet in the edit form. */
  onEdit: (pet: PetProfile) => void;
  /** Stage this pet for deletion — the caller gates it behind a confirm. */
  onRequestDelete: (pet: PetProfile) => void;
  /** Disables the trash while a delete is already in flight. */
  deletePending?: boolean;
}

/**
 * Compact left-rail row for the split-column desktop layout on /pets.
 * Analogous to a Messages-list row: avatar + name + quick meta, with an
 * active-selection state that mirrors iMessage-style selection.
 *
 * NOT one big <button> any more (owner, 2026-08-30: "add a pencil to edit and
 * a trashcan to delete"). The whole row used to BE the select button, and a
 * <button> cannot contain other buttons — nesting them is invalid HTML and
 * browsers recover from it unpredictably, which is exactly the nested-button
 * defect already fixed elsewhere in this app. So the row is a plain flex
 * container now: the select button owns the avatar + text and flexes to fill,
 * and the two icon actions sit beside it as siblings.
 */
export function PetRailRow({
  pet,
  active,
  onSelect,
  onEdit,
  onRequestDelete,
  deletePending = false,
}: PetRailRowProps) {
  const speciesLabel = SPECIES_OPTIONS.find((s) => s.value === pet.species)?.label;
  return (
    <div
      className="group/row w-full flex items-center gap-1 pr-2 transition-colors"
      style={{ background: active ? "hsl(var(--bark) / 0.10)" : "transparent" }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className="flex-1 min-w-0 flex items-center gap-3 pl-4 pr-1 py-2.5 text-left transition-colors active:bg-secondary/40"
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
      </button>

      {/* Edit + delete. Named per-pet, because "Edit" alone in a list of five
          pets tells a screen-reader user nothing about which one. Kept at the
          44px hit minimum via the padding rather than a bigger glyph. */}
      <button
        type="button"
        onClick={() => onEdit(pet)}
        aria-label={`Edit ${pet.name}`}
        className="shrink-0 w-9 h-9 rounded-ds-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:scale-[0.94] transition-colors"
      >
        <Pencil className="w-4 h-4" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => onRequestDelete(pet)}
        disabled={deletePending}
        aria-label={`Delete ${pet.name}`}
        className="shrink-0 w-9 h-9 rounded-ds-md inline-flex items-center justify-center transition-colors active:scale-[0.94] disabled:opacity-40 disabled:pointer-events-none hover:bg-[hsl(var(--destructive)/0.10)]"
        style={{ color: "hsl(var(--destructive))" }}
      >
        <Trash2 className="w-4 h-4" strokeWidth={2} />
      </button>
    </div>
  );
}
