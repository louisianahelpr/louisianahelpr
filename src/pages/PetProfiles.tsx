import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { unwrap } from "@/lib/supabaseResult";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";
import {
  Plus, ChevronDown, X,
  Stethoscope, AlertTriangle, Phone, Siren,
  UtensilsCrossed, Fingerprint, PawPrint,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type PetProfile = Database["public"]["Tables"]["pet_profiles"]["Row"];
type PetInsert = Database["public"]["Tables"]["pet_profiles"]["Insert"];

const SPECIES_OPTIONS = [
  { value: "dog", emoji: "🐕", label: "Dog" },
  { value: "cat", emoji: "🐈", label: "Cat" },
  { value: "bird", emoji: "🐦", label: "Bird" },
  { value: "rabbit", emoji: "🐇", label: "Rabbit" },
  { value: "reptile", emoji: "🦎", label: "Reptile" },
  { value: "other", emoji: "🐾", label: "Other" },
] as const;

const speciesEmoji = (species: string) =>
  SPECIES_OPTIONS.find((s) => s.value === species)?.emoji ?? "🐾";

const BLANK_FORM: Omit<PetInsert, "owner_id"> = {
  name: "",
  species: "dog",
  breed: "",
  age_years: null,
  weight_lbs: null,
  color_markings: "",
  microchip_id: "",
  vet_name: "",
  vet_phone: "",
  medical_notes: "",
  behavioral_notes: "",
  emergency_contact: "",
  feeding_schedule: "",
  photo_url: "",
  is_evacuation_registered: false,
};

interface PetFormProps {
  initialValues?: PetProfile | null;
  ownerId: string;
  onClose: () => void;
  onSaved: () => void;
}

function PetForm({ initialValues, ownerId, onClose, onSaved }: PetFormProps) {
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
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
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
              <label className="text-ds-11 text-muted-foreground block mb-1">Name</label>
              <input
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                placeholder="Max, Luna, Biscuit…"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-ds-11 text-muted-foreground block mb-1">Breed</label>
                <input
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  placeholder="e.g. Golden Retriever"
                  value={form.breed ?? ""}
                  onChange={(e) => set("breed", e.target.value)}
                />
              </div>
              <div>
                <label className="text-ds-11 text-muted-foreground block mb-1">Age (years)</label>
                <input
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
                <label className="text-ds-11 text-muted-foreground block mb-1">Weight (lbs)</label>
                <input
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
                <label className="text-ds-11 text-muted-foreground block mb-1">Color / markings</label>
                <input
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
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Vet &amp; medical
          </h3>
          <div className="rounded-ds-lg liquid-glass overflow-hidden px-4 py-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-ds-11 text-muted-foreground block mb-1">Vet name</label>
                <input
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  placeholder="Dr. Tran"
                  value={form.vet_name ?? ""}
                  onChange={(e) => set("vet_name", e.target.value)}
                />
              </div>
              <div>
                <label className="text-ds-11 text-muted-foreground block mb-1">Vet phone</label>
                <input
                  type="tel"
                  className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                  placeholder="(504) 555-0100"
                  value={form.vet_phone ?? ""}
                  onChange={(e) => set("vet_phone", e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-ds-11 text-muted-foreground block mb-1">Microchip ID</label>
              <input
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none"
                placeholder="985112345678901"
                value={form.microchip_id ?? ""}
                onChange={(e) => set("microchip_id", e.target.value)}
              />
            </div>
            <div>
              <label className="text-ds-11 text-muted-foreground block mb-1">
                Medical notes
              </label>
              <textarea
                rows={3}
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none resize-none"
                placeholder="Allergies, medications, special health needs…"
                value={form.medical_notes ?? ""}
                onChange={(e) => set("medical_notes", e.target.value)}
              />
            </div>
            <div>
              <label className="text-ds-11 text-muted-foreground block mb-1">
                Behavioral notes
              </label>
              <textarea
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
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Care instructions
          </h3>
          <div className="rounded-ds-lg liquid-glass overflow-hidden px-4 py-3 space-y-3">
            <div>
              <label className="text-ds-11 text-muted-foreground block mb-1">Feeding schedule</label>
              <textarea
                rows={2}
                className="glass-field w-full rounded-ds-md px-3 py-2 text-ds-14 text-foreground bg-transparent focus:outline-none resize-none"
                placeholder="1 cup dry food at 7am + 6pm, no table scraps…"
                value={form.feeding_schedule ?? ""}
                onChange={(e) => set("feeding_schedule", e.target.value)}
              />
            </div>
            <div>
              <label className="text-ds-11 text-muted-foreground block mb-1">Emergency contact</label>
              <input
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
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
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

// ─── Main page ────────────────────────────────────────────────────────────────

const PetProfiles = () => {
  usePageTitle("My Pets — Helpr");
  const { user } = useCurrentUser();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editingPet, setEditingPet] = useState<PetProfile | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Pet pending removal — gates the destructive delete behind a branded
  // confirm dialog instead of a native confirm() (off-brand in the
  // Capacitor iOS WebView).
  const [petToDelete, setPetToDelete] = useState<PetProfile | null>(null);

  const { data: pets, isLoading, isError, refetch } = useQuery({
    queryKey: ["pet_profiles", userId],
    enabled: !!userId,
    queryFn: async () => {
      return unwrap(
        await supabase
          .from("pet_profiles")
          .select("*")
          .eq("owner_id", userId!)
          .order("created_at", { ascending: true }),
      ) as PetProfile[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (petId: string) => {
      unwrap(await supabase.from("pet_profiles").delete().eq("id", petId));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pet_profiles", userId] });
      toast.success("Pet removed");
    },
    onError: (err) => {
      report(err, { tags: { area: "pet_profiles.delete" } });
      toast.error("Couldn't remove pet");
      hapticError();
    },
  });

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["pet_profiles", userId] });
  };

  const openAdd = () => {
    setEditingPet(null);
    setFormOpen(true);
  };

  const openEdit = (pet: PetProfile) => {
    setEditingPet(pet);
    setFormOpen(true);
  };

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader title="My Pets" />

      <div className="px-4 pt-4 space-y-3">
        {isLoading && (
          <div className="space-y-2">
            {[1, 2].map((n) => (
              <Skeleton key={n} className="rounded-ds-lg h-20" />
            ))}
          </div>
        )}

        {isError && (
          <ErrorState
            variant="inline"
            title="Couldn't load your pets."
            body="Tap Try again to reload your pet profiles."
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && !isError && pets?.length === 0 && (
          <EmptyState
            variant="inline"
            icon={PawPrint}
            title="No pets yet"
            body="Add your pets' profiles so helpers know their needs."
            action={
              <Button onClick={openAdd}>
                <Plus className="w-4 h-4 mr-1" /> Add a pet
              </Button>
            }
          />
        )}

        {pets?.map((pet) => {
          const isExpanded = expandedId === pet.id;
          return (
            <div
              key={pet.id}
              className="rounded-ds-lg liquid-glass overflow-hidden"
            >
              {/* Header row */}
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-secondary/40 transition-colors"
                onClick={() =>
                  setExpandedId(isExpanded ? null : pet.id)
                }
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
                      onClick={() => openEdit(pet)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive/30 hover:bg-destructive/5"
                      disabled={deleteMutation.isPending}
                      onClick={() => setPetToDelete(pet)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Add button — only when at least one pet exists. The empty
            state already renders its own "Add a pet" CTA, so showing this
            standalone one too would surface two identical CTAs at once. */}
        {!!pets?.length && (
          <Button
            className="w-full"
            variant="outline"
            size="lg"
            onClick={openAdd}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add a pet
          </Button>
        )}

        {/* Evacuation promo */}
        <div
          className="rounded-ds-lg overflow-hidden px-4 py-3 flex items-start gap-3"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--burnt-sienna) / 0.08), hsl(var(--bark) / 0.06))",
            border: "1px solid hsl(var(--burnt-sienna) / 0.18)",
          }}
        >
          <Siren
            className="w-5 h-5 shrink-0 mt-0.5"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          />
          <div>
            <p className="text-ds-13 font-semibold leading-tight" style={{ color: "hsl(var(--ink-deep))" }}>
              Hurricane Season Active
            </p>
            <p className="text-ds-11 text-muted-foreground leading-snug mt-0.5">
              Register your pets for evacuation transport. During a declared emergency, Helpr volunteers
              can help move your pets to safety.{" "}
              <a href="/evacuation" className="font-semibold underline" style={{ color: "hsl(var(--burnt-sienna))" }}>
                Learn more
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* Pet form sheet */}
      {formOpen && userId && (
        <PetForm
          initialValues={editingPet}
          ownerId={userId}
          onClose={() => setFormOpen(false)}
          onSaved={handleSaved}
        />
      )}

      <BrandConfirmDialog
        open={petToDelete !== null}
        onOpenChange={(open) => { if (!open) setPetToDelete(null); }}
        title={petToDelete ? `Remove ${petToDelete.name}?` : "Remove pet?"}
        description="This can't be undone."
        primaryLabel="Remove"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => {
          if (petToDelete) deleteMutation.mutate(petToDelete.id);
          setPetToDelete(null);
        }}
        secondaryLabel="Keep"
      />
    </div>
  );
};

export default PetProfiles;
