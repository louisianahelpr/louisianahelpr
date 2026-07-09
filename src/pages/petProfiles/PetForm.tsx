import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { unwrap } from "@/lib/supabaseResult";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";
import { X } from "lucide-react";
import type { PetProfile, PetInsert } from "./types";
import { SPECIES_OPTIONS, BLANK_FORM } from "./petProfilesHelpers";

interface PetFormProps {
  initialValues?: PetProfile | null;
  ownerId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function PetForm({ initialValues, ownerId, onClose, onSaved }: PetFormProps) {
  const [form, setForm] = useState<Omit<PetInsert, "owner_id">>({
    ...BLANK_FORM,
    ...(initialValues
      ? {
          name: initialValues.name,
          species: initialValues.species,
          breed: initialValues.breed ?? "",
          age_years: initialValues.age_years,
          weight_lbs: initialValues.weight_lbs,
          color_markings: initialValues.color_markings ?? "",
          microchip_id: initialValues.microchip_id ?? "",
          vet_name: initialValues.vet_name ?? "",
          vet_phone: initialValues.vet_phone ?? "",
          medical_notes: initialValues.medical_notes ?? "",
          behavioral_notes: initialValues.behavioral_notes ?? "",
          emergency_contact: initialValues.emergency_contact ?? "",
          feeding_schedule: initialValues.feeding_schedule ?? "",
          photo_url: initialValues.photo_url ?? "",
          is_evacuation_registered: initialValues.is_evacuation_registered,
        }
      : {}),
  });
  const [saving, setSaving] = useState(false);

  const set = (field: string, value: unknown) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Pet name is required");
      hapticError();
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
        photo_url: form.photo_url || null,
        is_evacuation_registered: form.is_evacuation_registered ?? false,
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
      toast.success(
        initialValues
          ? `${form.name} updated`
          : `${form.name} added to your pets`,
      );
      onSaved();
      onClose();
    } catch (err) {
      report(err, { tags: { area: "pet_profiles.save" } });
      toast.error("Couldn't save pet profile — please try again");
      hapticError();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-premium-page overflow-y-auto">
      {/* Header */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b"
        style={{ background: "hsl(var(--parchment))", borderColor: "hsl(var(--olivewood) / 0.12)" }}
      >
        <h2
          className="font-display font-bold text-ds-18"
          style={{ color: "hsl(var(--ink-deep))" }}
        >
          {initialValues ? `Edit ${initialValues.name}` : "Add a pet"}
        </h2>
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
        {/* Basic info */}
        <section>
          <h3
            className="font-serif italic uppercase text-ds-9 mb-3"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
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
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-ds-12 font-medium transition-all"
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
                placeholder="Max, Luna, Biscuit…"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pet-breed" className="text-ds-11 text-muted-foreground block mb-1">Breed</label>
                <input
                  id="pet-breed"
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  placeholder="e.g. Golden Retriever"
                  value={form.breed ?? ""}
                  onChange={(e) => set("breed", e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="pet-age" className="text-ds-11 text-muted-foreground block mb-1">Age (years)</label>
                <input
                  id="pet-age"
                  type="number"
                  min={0}
                  max={30}
                  step={0.5}
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  placeholder="3"
                  value={form.age_years ?? ""}
                  onChange={(e) =>
                    set("age_years", e.target.value ? parseFloat(e.target.value) : null)
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pet-weight" className="text-ds-11 text-muted-foreground block mb-1">Weight (lbs)</label>
                <input
                  id="pet-weight"
                  type="number"
                  min={0}
                  step={0.5}
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  placeholder="45"
                  value={form.weight_lbs ?? ""}
                  onChange={(e) =>
                    set("weight_lbs", e.target.value ? parseFloat(e.target.value) : null)
                  }
                />
              </div>
              <div>
                <label htmlFor="pet-color" className="text-ds-11 text-muted-foreground block mb-1">Color / markings</label>
                <input
                  id="pet-color"
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  placeholder="Black & white"
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
            className="font-serif italic uppercase text-ds-9 mb-3"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
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
                  placeholder="Dr. Tran"
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
                  placeholder="(504) 555-0100"
                  value={form.vet_phone ?? ""}
                  onChange={(e) => set("vet_phone", e.target.value)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="pet-microchip" className="text-ds-11 text-muted-foreground block mb-1">Microchip ID</label>
              <input
                id="pet-microchip"
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                placeholder="985112345678901"
                value={form.microchip_id ?? ""}
                onChange={(e) => set("microchip_id", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="pet-medical-notes" className="text-ds-11 text-muted-foreground block mb-1">
                Medical notes
              </label>
              <textarea
                id="pet-medical-notes"
                rows={3}
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none resize-none"
                placeholder="Allergies, medications, special health needs…"
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
            className="font-serif italic uppercase text-ds-9 mb-3"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
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
                placeholder="1 cup dry food at 7am + 6pm, no table scraps…"
                value={form.feeding_schedule ?? ""}
                onChange={(e) => set("feeding_schedule", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="pet-emergency-contact" className="text-ds-11 text-muted-foreground block mb-1">Emergency contact</label>
              <input
                id="pet-emergency-contact"
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                placeholder="Mom — (504) 555-0199"
                value={form.emergency_contact ?? ""}
                onChange={(e) => set("emergency_contact", e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Evacuation */}
        <section>
          <h3
            className="font-serif italic uppercase text-ds-9 mb-3"
            style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
          >
            Hurricane &amp; evacuation
          </h3>
          <div className="rounded-ds-lg liquid-glass overflow-hidden px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-ds-13 font-semibold text-foreground leading-tight">
                  Register for evacuation help
                </p>
                <p className="text-ds-11 text-muted-foreground mt-0.5 leading-snug">
                  During a declared emergency, Helpr volunteers can see your
                  pet and offer transport to a safe location.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.is_evacuation_registered}
                onClick={() => {
                  const next = !form.is_evacuation_registered;
                  set("is_evacuation_registered", next);
                  if (next) {
                    toast("Registered — your pet will be visible to transport volunteers during an emergency", {
                      icon: "🛟",
                    });
                  }
                }}
                className="shrink-0 w-12 h-7 rounded-full transition-colors focus:outline-none"
                style={{
                  background: form.is_evacuation_registered
                    ? "hsl(var(--bark))"
                    : "hsl(var(--olivewood) / 0.20)",
                }}
              >
                <span
                  className="block w-5 h-5 rounded-full bg-white shadow-sm transition-transform mx-1"
                  style={{
                    transform: form.is_evacuation_registered
                      ? "translateX(20px)"
                      : "translateX(0)",
                  }}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Save */}
        <Button
          className="w-full"
          size="lg"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? "Saving…" : initialValues ? "Save changes" : "Add pet"}
        </Button>
      </div>
    </div>
  );
}
