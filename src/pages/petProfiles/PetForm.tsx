import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { unwrap } from "@/lib/supabaseResult";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";
import { X } from "lucide-react";
import type { PetProfile } from "./types";
import {
  SPECIES_OPTIONS,
  PET_AGE_MAX,
  PET_WEIGHT_MAX,
  buildPetForm,
  isPetFormDirty,
  validatePetForm,
} from "./petProfilesHelpers";

/** Focusable descendants, for the sheet variant's focus containment. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

// Species-filtered breed suggestions for the datalist under the Breed field.
// Louisiana-common picks, not a taxonomy — free text remains the source of
// truth.
const BREED_SUGGESTIONS: Record<string, string[]> = {
  dog: ["Lab mix", "Catahoula Leopard Dog", "Labrador Retriever", "Pit bull mix", "Golden Retriever", "German Shepherd", "Beagle", "Chihuahua", "Shih Tzu", "Mixed breed"],
  cat: ["Domestic Shorthair", "Domestic Longhair", "Orange Tabby", "Tabby", "Siamese", "Calico", "Maine Coon", "Tuxedo", "Mixed breed"],
  bird: ["Parakeet", "Cockatiel", "Conure", "Chicken", "Duck"],
  rabbit: ["Holland Lop", "Lionhead", "Rex", "Mixed breed"],
  reptile: ["Bearded Dragon", "Ball Python", "Red-Eared Slider", "Leopard Gecko"],
  other: [],
};

interface PetFormProps {
  initialValues?: PetProfile | null;
  ownerId: string;
  onClose: () => void;
  onSaved: () => void;
  /** Names of the owner's existing pets — powers the duplicate-name
      confirm ("Gumbo" was in the list twice before this guard). */
  existingNames?: string[];
  /**
   * "sheet" (default) — full-screen fixed overlay, used on mobile.
   * "inline" — renders in the normal document flow so it can live inside
   * the split-column desktop right pane without covering the left rail.
   */
  variant?: "sheet" | "inline";
}

export function PetForm({
  existingNames = [],
  initialValues,
  ownerId,
  onClose,
  onSaved,
  variant = "sheet",
}: PetFormProps) {
  const [form, setForm] = useState(() => buildPetForm(initialValues));
  // One-shot: first Save with a duplicate name warns; second commits.
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false);
  // The values this form opened with — the baseline the unsaved-changes guard
  // compares against. useRef only honours its argument on the first render, so
  // this snapshot never drifts as the user types.
  const initialFormRef = useRef(form);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const set = (field: string, value: unknown) => {
    // The one-shot duplicate confirmation is a claim about a SPECIFIC name —
    // editing the name invalidates it, or "Boo" confirmed once would let a
    // later duplicate "Gumbo" sail through unconfirmed.
    if (field === "name") setConfirmedDuplicate(false);
    setForm((f) => ({ ...f, [field]: value }));
  };

  const isInline = variant === "inline";

  const errors = useMemo(() => validatePetForm(form), [form]);
  const firstError = Object.values(errors)[0];
  // Required-ness is surfaced only once the user has touched something — a
  // pristine "Add a pet" sheet shouldn't open with a red error on it.
  const nameMissing = !form.name.trim();
  const isDirty = isPetFormDirty(form, initialFormRef.current);
  const canSave = !nameMissing && !firstError;

  // Closing discards everything typed since open — nothing is persisted until
  // handleSave runs — so a filled-in form has to be confirmed before it goes.
  const requestClose = useCallback(() => {
    if (isDirty && !saving) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }, [isDirty, saving, onClose]);

  // ── Sheet-variant modal semantics ────────────────────────────────────────
  // The sheet is a `fixed inset-0` overlay: it covers the page, but the page
  // behind it stays in the tab order, so focus has to be moved in and kept in.
  // Deliberately hand-rolled rather than refactored onto <SheetContent>: that
  // primitive has no full-bleed side, and its scrim + p-6 + floating close
  // button would visually redesign a screen this change isn't meant to touch.
  useEffect(() => {
    if (isInline) return;
    const node = dialogRef.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    node.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [isInline]);

  // Escape closes the sheet — routed through the same guard as the X so it
  // can't silently throw away a filled-in form. Skipped while the discard
  // confirmation is up: that dialog owns Escape (Radix closes it itself).
  useEffect(() => {
    if (isInline || confirmDiscard) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      requestClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isInline, confirmDiscard, requestClose]);

  const handleSave = async () => {
    if (nameMissing) {
      toast.error("Pet name is required.");
      hapticError();
      return;
    }
    if (firstError) {
      toast.error(firstError);
      hapticError();
      return;
    }
    // Duplicate-name guard (create only): the same pet added twice renders as
    // two identical rows with no clue which is canonical — the owner's own
    // list carried "Gumbo" twice. One extra tap confirms an intentional
    // same-name pet (two cats both named Boo is legal), a repeat tap of the
    // same mistake is caught.
    if (
      !initialValues?.id &&
      existingNames.some((n) => n.trim().toLowerCase() === form.name.trim().toLowerCase()) &&
      !confirmedDuplicate
    ) {
      setConfirmedDuplicate(true);
      toast.warning(`You already have a pet named ${form.name.trim()} — tap Save again if this is a different ${form.species}.`);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        owner_id: ownerId,
        name: form.name.trim(),
        species: form.species as string,
        breed: form.breed || null,
        age_years: form.age_years,
        weight_lbs: form.weight_lbs,
        color_markings: form.color_markings || null,
        microchip_id: form.microchip_id || null,
        vet_name: form.vet_name || null,
        vet_phone: form.vet_phone || null,
        medical_notes: form.medical_notes || null,
        behavioral_notes: form.behavioral_notes || null,
        emergency_contact: form.emergency_contact || null,
        feeding_schedule: form.feeding_schedule || null,
        updated_at: new Date().toISOString(),
      };
      if (initialValues?.id) {
        unwrap(
          await supabase
            .from("pet_profiles")
            .update(payload)
            .eq("id", initialValues.id),
        );
      } else {
        unwrap(await supabase.from("pet_profiles").insert(payload));
      }
      onSaved();
      onClose();
    } catch (err) {
      report(err, { tags: { area: "pet_profiles.save" } });
      toast.error("Couldn't save pet profile — please try again.");
      hapticError();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div
      ref={dialogRef}
      role={isInline ? undefined : "dialog"}
      aria-modal={isInline ? undefined : true}
      aria-labelledby={isInline ? undefined : "pet-form-title"}
      tabIndex={isInline ? undefined : -1}
      className={
        isInline
          ? "rounded-ds-lg liquid-glass overflow-hidden"
          : "fixed inset-0 z-50 flex flex-col bg-premium-page overflow-y-auto focus:outline-none"
      }
    >
      {/* Header */}
      <div
        className={
          isInline
            ? "flex items-center justify-between px-4 py-3 border-b"
            : "sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b"
        }
        style={{
          background: isInline ? "transparent" : "hsl(var(--parchment))",
          borderColor: "hsl(var(--olivewood) / 0.12)",
          // Full-screen sheet starts at y=0, so on a notched device this header
          // sat UNDER the status bar — the owner's "top is cut off" on Add a
          // pet, with the clock painted over the title. `var(--safe-area-top)`
          // (resolved at :root) rather than a bare env(): this tree lives
          // inside <PageTransition>'s transform, where WebKit reports every
          // env(safe-area-inset-*) as 0, so the raw form would silently do
          // nothing on exactly the devices that need it.
          ...(isInline ? null : { paddingTop: "calc(var(--safe-area-top, 0px) + 0.75rem)" }),
        }}
      >
        {/* Structure stays hand-rolled on purpose (see the note above — this
            is not a SheetContent), but the TYPE matches SheetHero/DialogHero:
            display-italic at the shared clamp. It was display-UPRIGHT at a flat
            18px, the only popup title in the app that wasn't italic. */}
        <h2
          id={isInline ? undefined : "pet-form-title"}
          className="font-display italic font-bold leading-tight"
          style={{
            fontSize: "clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem)",
            color: "hsl(var(--ink-deep))",
            letterSpacing: "-0.02em",
          }}
        >
          {initialValues ? `Edit ${initialValues.name}` : "Add a Pet"}
        </h2>
        <button
          type="button"
          onClick={requestClose}
          className="w-10 h-10 flex items-center justify-center rounded-full active:bg-secondary/60 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      <div
        className={
          isInline
            ? "px-4 py-4 space-y-5"
            : "px-4 py-4 space-y-5 pb-safe-nav"
        }
      >
        {/* Basic info */}
        <section>
          <h3
            className="font-sans font-semibold text-ds-14 mb-3"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Basic info
          </h3>
          <div className="rounded-ds-lg liquid-glass overflow-hidden px-4 py-3 space-y-3">
            {/* Species chips */}
            <div>
              <label className="text-ds-11 text-muted-foreground block mb-1.5">Species</label>
              <div className="flex flex-wrap gap-2">
                {SPECIES_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => set("species", s.value)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-ds-md text-ds-12 font-medium transition-all"
                    style={{
                      background:
                        form.species === s.value
                          ? "hsl(var(--bark) / 0.15)"
                          : "hsl(var(--olivewood) / 0.06)",
                      color:
                        form.species === s.value
                          ? "hsl(var(--bark))"
                          : "hsl(var(--olivewood) / 0.8)",
                      border:
                        form.species === s.value
                          ? "1px solid hsl(var(--bark) / 0.35)"
                          : "1px solid transparent",
                    }}
                  >
                    <span>{s.emoji}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="pet-name" className="text-ds-11 text-muted-foreground block mb-1">Name</label>
              <input
                id="pet-name"
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={isDirty && nameMissing ? true : undefined}
                aria-describedby={
                  isDirty && nameMissing ? "pet-name-error" : undefined
                }
              />
              {isDirty && nameMissing && (
                <FieldError id="pet-name-error">Pet name is required.</FieldError>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pet-breed" className="text-ds-11 text-muted-foreground block mb-1">Breed</label>
                <input
                  id="pet-breed"
                  list="pet-breed-suggestions"
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  placeholder="e.g. Lab mix"
                  value={form.breed ?? ""}
                  onChange={(e) => set("breed", e.target.value)}
                />
                {/* Free text stays free — the datalist only steers. It is
                    species-filtered so a cat is never offered "Dog" (the
                    owner's own list had a cat whose breed was Dog). */}
                <datalist id="pet-breed-suggestions">
                  {(BREED_SUGGESTIONS[form.species as string] ?? []).map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </div>
              <div>
                <label htmlFor="pet-age" className="text-ds-11 text-muted-foreground block mb-1">Age (years)</label>
                <input
                  id="pet-age"
                  type="number"
                  min={0}
                  max={PET_AGE_MAX}
                  step={0.5}
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  value={form.age_years ?? ""}
                  onChange={(e) =>
                    set("age_years", e.target.value ? Number(e.target.value) : null)
                  }
                  aria-invalid={errors.age_years ? true : undefined}
                  aria-describedby={errors.age_years ? "pet-age-error" : undefined}
                />
                {errors.age_years && (
                  <FieldError id="pet-age-error">{errors.age_years}</FieldError>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pet-weight" className="text-ds-11 text-muted-foreground block mb-1">Weight (lbs)</label>
                <input
                  id="pet-weight"
                  type="number"
                  min={0}
                  max={PET_WEIGHT_MAX}
                  step={0.5}
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  value={form.weight_lbs ?? ""}
                  onChange={(e) =>
                    set("weight_lbs", e.target.value ? Number(e.target.value) : null)
                  }
                  aria-invalid={errors.weight_lbs ? true : undefined}
                  aria-describedby={errors.weight_lbs ? "pet-weight-error" : undefined}
                />
                {errors.weight_lbs && (
                  <FieldError id="pet-weight-error">{errors.weight_lbs}</FieldError>
                )}
              </div>
              <div>
                <label htmlFor="pet-color" className="text-ds-11 text-muted-foreground block mb-1">Color / markings</label>
                <input
                  id="pet-color"
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  value={form.color_markings ?? ""}
                  onChange={(e) => set("color_markings", e.target.value)}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Vet & medical */}
        <section>
          <h3
            className="font-sans font-semibold text-ds-14 mb-3"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Vet &amp; medical
          </h3>
          <div className="rounded-ds-lg liquid-glass overflow-hidden px-4 py-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pet-vet-name" className="text-ds-11 text-muted-foreground block mb-1">Vet name</label>
                <input
                  id="pet-vet-name"
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  value={form.vet_name ?? ""}
                  onChange={(e) => set("vet_name", e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="pet-vet-phone" className="text-ds-11 text-muted-foreground block mb-1">Vet phone</label>
                <input
                  id="pet-vet-phone"
                  type="tel"
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  value={form.vet_phone ?? ""}
                  onChange={(e) => set("vet_phone", e.target.value)}
                  aria-invalid={errors.vet_phone ? true : undefined}
                  aria-describedby={errors.vet_phone ? "pet-vet-phone-error" : undefined}
                />
                {errors.vet_phone && (
                  <FieldError id="pet-vet-phone-error">{errors.vet_phone}</FieldError>
                )}
              </div>
            </div>
            <div>
              <label htmlFor="pet-microchip" className="text-ds-11 text-muted-foreground block mb-1">Microchip ID</label>
              <input
                id="pet-microchip"
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                value={form.microchip_id ?? ""}
                onChange={(e) => set("microchip_id", e.target.value)}
                aria-invalid={errors.microchip_id ? true : undefined}
                aria-describedby={errors.microchip_id ? "pet-microchip-error" : undefined}
              />
              {errors.microchip_id && (
                <FieldError id="pet-microchip-error">{errors.microchip_id}</FieldError>
              )}
            </div>
            <div>
              <label htmlFor="pet-medical-notes" className="text-ds-11 text-muted-foreground block mb-1">
                Medical notes
              </label>
              <textarea
                id="pet-medical-notes"
                rows={3}
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none resize-none"
                value={form.medical_notes ?? ""}
                onChange={(e) => set("medical_notes", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="pet-behavioral-notes" className="text-ds-11 text-muted-foreground block mb-1">
                Behavioral notes
              </label>
              <textarea
                id="pet-behavioral-notes"
                rows={2}
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none resize-none"
                placeholder="Anxious around thunder, reactive on leash, loves people…"
                value={form.behavioral_notes ?? ""}
                onChange={(e) => set("behavioral_notes", e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Care instructions */}
        <section>
          <h3
            className="font-sans font-semibold text-ds-14 mb-3"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Care instructions
          </h3>
          <div className="rounded-ds-lg liquid-glass overflow-hidden px-4 py-3 space-y-3">
            <div>
              <label htmlFor="pet-feeding" className="text-ds-11 text-muted-foreground block mb-1">Feeding schedule</label>
              <textarea
                id="pet-feeding"
                rows={2}
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none resize-none"
                value={form.feeding_schedule ?? ""}
                onChange={(e) => set("feeding_schedule", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="pet-emergency-contact" className="text-ds-11 text-muted-foreground block mb-1">Emergency contact</label>
              <input
                id="pet-emergency-contact"
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                value={form.emergency_contact ?? ""}
                onChange={(e) => set("emergency_contact", e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Save */}
        <Button
          className="w-full"
          size="lg"
          disabled={saving || !canSave}
          onClick={handleSave}
        >
          {saving ? "Saving…" : initialValues ? "Save Changes" : "Add Pet"}
        </Button>
      </div>
    </div>

    {/* Discard guard. `primaryTone="bark"`, not sienna: the saved pet is
        untouched by cancelling, and BrandConfirmDialog reserves sienna for
        genuinely destructive actions like deletes. */}
    <BrandConfirmDialog
      open={confirmDiscard}
      onOpenChange={(open) => { if (!open) setConfirmDiscard(false); }}
      title={
        initialValues
          ? `Discard changes to ${initialValues.name}?`
          : "Discard This Pet?"
      }
      description={
        initialValues
          ? "Your edits haven't been saved. Closing keeps the details you had before."
          : "Nothing has been saved yet — everything you typed will be lost."
      }
      primaryLabel="Discard"
      primaryTone="bark"
      primaryHaptic="warning"
      onPrimary={() => {
        setConfirmDiscard(false);
        onClose();
      }}
      secondaryLabel="Keep Editing"
    />
    </>
  );
}

/** Inline field error — sienna, announced, and tied to its input via id. */
function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p
      id={id}
      role="alert"
      className="text-ds-11 mt-1 leading-snug"
      style={{ color: "hsl(var(--burnt-sienna))" }}
    >
      {children}
    </p>
  );
}
