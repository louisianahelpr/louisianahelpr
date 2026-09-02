import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHero,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { unwrap } from "@/lib/supabaseResult";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
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
   * "sheet" (default) — the shared popup shell, used on mobile.
   * "inline" — renders in the normal document flow so it can live inside
   * the desktop right pane without covering the left rail.
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
  const requestClose = () => {
    if (isDirty && !saving) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

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
      hapticSuccess();
      toast(initialValues ? "Pet updated" : "Pet added");
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

  const saveLabel = saving ? "Saving…" : initialValues ? "Save Changes" : "Add Pet";

  // ── The form itself ──────────────────────────────────────────────────────
  // ONE body, rendered into two shells (the popup on mobile, the desktop
  // right-pane card). It carries no padding of its own: the popup shell
  // supplies `p-4 sm:p-5` and the inline card supplies `px-4 py-4`, so a
  // padding here would double up in both.
  const formBody = (
    <div className="space-y-5">
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
            {/* A REAL 3-COLUMN GRID, not `flex flex-wrap`.
                All six species belong (dog · cat · bird · rabbit · reptile ·
                other) — the owner's screenshot showed the second row sliced in
                half by the broken dialog edge, not a row that should not exist.
                Wrapping laid them out 3 / 2 / 1, so the "second row" read as
                overflow rather than as the rest of one list; a fixed 3-across
                grid makes it two even rows of three at every width, and every
                chip the same size.

                Two columns below 360px: measured at 320 (the narrowest device
                supported) a third of the card is 68px, and "🦎 Reptile",
                "🐇 Rabbit" and "🐾 Other" each need ~74-80px, so three across
                spilled each of those labels over its neighbour. Three rows of
                two whole chips beats two rows of clipped ones.

                `max-w-md` caps the ROW, not the card. The desktop right-pane
                variant renders in a ~1400px column, and an uncapped 3-column
                grid stretched each chip to 328px — six letterbox slabs for
                six one-word labels. The fields below are meant to fill the
                card; a segmented control is not. */}
            <div className="grid grid-cols-2 min-[360px]:grid-cols-3 gap-2 max-w-md">
              {SPECIES_OPTIONS.map((s) => {
                const active = form.species === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => set("species", s.value)}
                    aria-pressed={active}
                    // SELECTED IS GLOSSY (project standard) — `btn-grad-primary`,
                    // the same radial bark gradient the primary CTA and
                    // ReportDialog's selected reason use. It was a flat
                    // `--bark/0.15` wash, which is the one thing a selected
                    // control in this app must never be.
                    className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-ds-md text-ds-12 font-medium transition-all duration-150 ease-ds-spring active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      active
                        ? "btn-grad-primary text-[hsl(var(--parchment))] border border-[hsl(var(--bark))] shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_1px_1px_hsl(var(--ink-deep)/0.10),0_2px_6px_hsl(var(--ink-deep)/0.12)]"
                        : "bg-secondary/45 border border-border/60 hover:bg-secondary/70 hover:border-border shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] text-[hsl(var(--olivewood)/0.8)]"
                    }`}
                  >
                    <span aria-hidden>{s.emoji}</span>
                    <span>{s.label}</span>
                  </button>
                );
              })}
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
                // "Lab mix", not "e.g. Lab mix": this input is a half-width
                // column, and iOS forces every field to a 16px minimum
                // (index.css, `@media (pointer: coarse)`), so the longer
                // string was clipped mid-word at 393 and below.
                placeholder="Lab mix"
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
            {/* rows={3}, not 2. The placeholder below wraps to three lines at
                the 16px minimum iOS forces on touch devices (index.css,
                `@media (pointer: coarse)`), so a two-row box clipped its own
                placeholder AND made the empty field a second scroller inside
                the popup — measured scrollHeight 93 against clientHeight 67
                with nothing typed. The popup is meant to be the only thing
                that scrolls. */}
            <textarea
              id="pet-behavioral-notes"
              rows={3}
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
    </div>
  );

  /* Discard guard. `primaryTone="bark"`, not sienna: the saved pet is
     untouched by cancelling, and BrandConfirmDialog reserves sienna for
     genuinely destructive actions like deletes. */
  const discardGuard = (
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
  );

  // ── Desktop right pane: a card in normal flow, not a popup ───────────────
  if (isInline) {
    return (
      <>
        <div className="rounded-ds-lg liquid-glass overflow-hidden">
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}
          >
            {/* Type matched to DialogHero's title so the inline card and the
                popup read as the same object at two sizes. */}
            <h2
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

          <div className="px-4 py-4 space-y-5">
            {formBody}
            <Button
              className="w-full"
              size="lg"
              disabled={saving || !canSave}
              onClick={handleSave}
            >
              {saveLabel}
            </Button>
          </div>
        </div>
        {discardGuard}
      </>
    );
  }

  // ── Mobile / popup: THE SHARED SHELL ─────────────────────────────────────
  //
  // WHAT WAS WRONG, MEASURED (2026-08-31, owner's device screenshot + a
  // Chromium repro at 393x852):
  //
  // This was a hand-rolled `fixed inset-0` overlay. `position: fixed` resolves
  // against the VIEWPORT only while no ancestor establishes a containing
  // block — and one does. `AppPage` wraps its children in
  // `<div className="animate-ds-page-in">`, whose keyframe ends on
  // `transform: translateY(0)` with `animation-fill-mode: forwards`. The fill
  // state keeps that transform applied forever (computed
  // `transform: matrix(1,0,0,1,0,0)`, i.e. NOT `none`), and a non-none
  // transform makes an element the containing block for every fixed
  // descendant. So `inset-0` sized this overlay to the /pets CONTENT COLUMN,
  // not the screen: measured 329x433 at an offset of (32, 16) inside a
  // 393x852 viewport — 50.8% of the viewport height, 84% of its width, with
  // the Breed/Age row sliced in half by the bottom edge and the whole lower
  // half of the screen left grey. On the owner's device, whose pets list is
  // shorter, the same bug produced the ~30% box they photographed. It WAS
  // scrollable (scrollHeight 1504 vs clientHeight 433), which is why the fault
  // is not "overflow is hidden" — the box itself was the wrong size, and no
  // amount of `overflow-y-auto` fixes a container measured against the wrong
  // rectangle.
  //
  // A Radix popup portals to `document.body`, outside that transformed
  // subtree, so the containing block is the viewport again — by construction,
  // not by a class that the next transformed ancestor would break. That is the
  // real fix, and it deletes the hand-rolled focus trap, Escape handler and
  // `--safe-area-top` header padding this file carried to emulate a modal.
  //
  // GEOMETRY — matched to `dashboard/JobDetailDialog.tsx`, the reference phone
  // popup, and to the same rules its comment block records:
  //
  //   grid-cols-1
  //     The base DialogContent is `display:grid` with implicit `auto` columns,
  //     which size to max-content; paired with the base's `overflow-y-auto`
  //     (which computes overflow-x to `auto`) an over-wide track gets clipped.
  //     Pins the track to `minmax(0,1fr)` so the two-up field rows wrap.
  //
  //   top-[7vh] bottom-auto [translate:-50%_0]
  //     TOP-anchored at every width, bottom free. The base centres vertically,
  //     and a vertically-centred box re-centres as its content grows — this
  //     form grows every time a validation error appears under a field, so
  //     centring would nudge the whole card up mid-typing. `[translate:…]` and
  //     not `translate-y-0`: the base centres with the standalone `translate`
  //     PROPERTY (so tailwindcss-animate's `transform` keyframes cannot clobber
  //     it), and Tailwind's `translate-y-*` utilities write `transform`, a
  //     different property — they would leave the base's `-50%` in force and
  //     push the header above y=0.
  //
  //   max-h-[86dvh]
  //     A CEILING, not a height — no `h-*`, so a short form (an edit with the
  //     card collapsed) hugs its content and only a form taller than the
  //     ceiling scrolls, in the base's own `overflow-y-auto`. 7 + 86 = 93vh
  //     leaves a bottom gutter symmetric with the top; 92 would put the Add Pet
  //     button under the home indicator. `dvh`, not the base's `vh`, so a
  //     mobile browser's dynamic toolbar cannot push the card off screen.
  //
  //   content-start
  //     A grid's default `align-content` behaves as stretch, which would
  //     inflate every row the moment anyone puts an `h-*` back. No-op today,
  //     guard tomorrow.
  //
  // DELIBERATELY ABSENT: no width override (the shell owns the 512px measure);
  // no `grid-rows-[…]` and no pinned footer — the footer is a normal
  // `<DialogFooter>` in flow, because pinning one to the bottom edge of a box
  // taller than its content just moves the emptiness above the button; no
  // radius or `overscroll-contain` (`.glass-modal` already sets
  // `border-radius: 28px` and `overscroll-behavior-y: contain`).
  return (
    <>
      {/* `open` is a constant: the parent mounts this component only while the
          form should be up, and unmounts it from `onClose`. Radix is therefore
          fully controlled — Escape, an overlay tap and the shell's own X each
          report through `onOpenChange` and nothing closes until the
          unsaved-changes guard says so. That is three exits covered by one
          guard; the hand-rolled sheet could only see its own X, and needed a
          bespoke Escape listener for the second. */}
      <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
        <DialogContent
          // Without this Radix focuses the Name input on open, which pops the
          // iOS keyboard over a form the user has not looked at yet. The shell
          // parks focus on the dialog container instead (see dialog.tsx), so
          // the modal still owns focus and Tab still starts inside it.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={[
            "grid-cols-1",
            // Centring inherited from DialogContent — this line used to opt
            // out with `top-[7vh] bottom-auto [translate:-50%_0]`. Removed
            // with JobDetailDialog's and PetReportCard's (since deleted); all three
            // copies of the same override of the shared shell.
            "max-h-[86dvh]",
            "content-start",
          ].join(" ")}
        >
          <DialogHero title={initialValues ? `Edit ${initialValues.name}` : "Add a Pet"} />
          {formBody}
          <DialogFooter>
            <DialogPrimaryAction
              disabled={saving || !canSave}
              onClick={handleSave}
            >
              {saveLabel}
            </DialogPrimaryAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {discardGuard}
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
