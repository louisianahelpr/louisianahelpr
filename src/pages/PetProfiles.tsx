import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/PageHeader";
import NotificationPanel from "@/components/NotificationPanel";
import { Button } from "@/components/ui/button";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { unwrap } from "@/lib/supabaseResult";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";
import { Plus, Siren, PawPrint } from "lucide-react";
import type { PetProfile } from "./petProfiles/types";
import { PetForm } from "./petProfiles/PetForm";
import { PetCard } from "./petProfiles/PetCard";

// ─── Main page ────────────────────────────────────────────────────────────────

const PetProfiles = () => {
  usePageTitle("My Pets — Helpr");
  const navigate = useNavigate();
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
      toast.error("Couldn't remove that pet — try again?");
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
      <PageHeader
        eyebrow="Your animals"
        title="My Pets"
        meta="Care details your Helpr should know"
        onBack={() => navigate("/profile")}
        showBrand
        rightSlot={<NotificationPanel />}
        width="2xl"
      />

      <div className="max-w-2xl mx-auto px-5 lg:px-8 pt-4 space-y-3">
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
              <Button variant="bark" onClick={openAdd}>
                <Plus className="w-4 h-4 mr-1" /> Add a pet
              </Button>
            }
          />
        )}

        {pets?.map((pet) => (
          <PetCard
            key={pet.id}
            pet={pet}
            isExpanded={expandedId === pet.id}
            onToggle={() =>
              setExpandedId(expandedId === pet.id ? null : pet.id)
            }
            onEdit={openEdit}
            onRequestDelete={setPetToDelete}
            deletePending={deleteMutation.isPending}
          />
        ))}

        {/* Add button — only when at least one pet exists. The empty
            state already renders its own "Add a pet" CTA, so showing this
            standalone one too would surface two identical CTAs at once. */}
        {!!pets?.length && (
          <Button
            variant="bark"
            className="w-full"
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
