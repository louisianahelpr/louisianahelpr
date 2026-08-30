import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { unwrap } from "@/lib/supabaseResult";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";
import { Plus, PawPrint } from "lucide-react";
import type { PetProfile } from "./petProfiles/types";
import { PetForm } from "./petProfiles/PetForm";
import { PetCard } from "./petProfiles/PetCard";
import { PetRailRow } from "./petProfiles/PetRailRow";
import { PetDetail } from "./petProfiles/PetDetail";

// ─── Main page ────────────────────────────────────────────────────────────────

const PetProfiles = () => {
  usePageTitle("My Pets — Helpr");
  const { user } = useCurrentUser();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Mobile: full-screen sheet form. Desktop: inline right-pane form.
  const [formOpen, setFormOpen] = useState(false);
  const [editingPet, setEditingPet] = useState<PetProfile | null>(null);
  // Desktop-only: reveal the inline create form in the right pane.
  const [desktopAdding, setDesktopAdding] = useState(false);
  // Mobile-only: which card is expanded in the stacked list.
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

  // Desktop: active pet id lives in the URL (?pet=<id>) so deep-links work.
  const activePetId = searchParams.get("pet");
  const activePet = useMemo(
    () => pets?.find((p) => p.id === activePetId) ?? null,
    [pets, activePetId],
  );

  // If the URL points at a pet that no longer exists (e.g. after delete),
  // clear the param so the desktop right pane shows the empty state instead
  // of stranding a dead ID.
  useEffect(() => {
    if (!activePetId) return;
    if (isLoading) return;
    if (!pets) return;
    if (!pets.some((p) => p.id === activePetId)) {
      const next = new URLSearchParams(searchParams);
      next.delete("pet");
      setSearchParams(next, { replace: true });
    }
  }, [activePetId, pets, isLoading, searchParams, setSearchParams]);

  const deleteMutation = useMutation({
    mutationFn: async (petId: string) => {
      unwrap(await supabase.from("pet_profiles").delete().eq("id", petId));
    },
    onSuccess: (_data, petId) => {
      queryClient.invalidateQueries({ queryKey: ["pet_profiles", userId] });
      // If we just deleted the active desktop pet, clear the URL param.
      if (petId === activePetId) {
        const next = new URLSearchParams(searchParams);
        next.delete("pet");
        setSearchParams(next, { replace: true });
      }
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

  // Mobile add: open the full-screen sheet form (existing behavior).
  const openAddMobile = () => {
    setEditingPet(null);
    setFormOpen(true);
  };

  // Desktop add: reveal the inline right-pane create form, clearing the
  // active-pet URL param so the pane isn't showing a detail underneath.
  const openAddDesktop = () => {
    setDesktopAdding(true);
    const next = new URLSearchParams(searchParams);
    next.delete("pet");
    setSearchParams(next, { replace: true });
  };

  // Mobile edit: open the full-screen sheet form.
  const openEditMobile = (pet: PetProfile) => {
    setEditingPet(pet);
    setFormOpen(true);
  };

  // Desktop: select a pet → write ?pet=<id>, close any inline-add mode.
  const selectPetDesktop = (pet: PetProfile) => {
    setDesktopAdding(false);
    const next = new URLSearchParams(searchParams);
    next.set("pet", pet.id);
    setSearchParams(next, { replace: true });
  };

  return (
    // AppPage — the shared signed-in sub-screen shell (AppShell + the Profile
    // tab header + the centered content column). No title-row "Add" (owner):
    // desktop Add is reachable from the list card's own empty-state CTA and
    // from the pet detail pane, so it doesn't need a second entry point.
    <AppPage title="My Pets" backTo="/profile">
        {/* ─── Mobile (default): stacked list ─────────────────────────── */}
        <div className="lg:hidden space-y-3">
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
              title="We couldn't load your pets."
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
                <Button variant="primary" onClick={openAddMobile}>
                  <Plus className="w-4 h-4 mr-1" /> Add a Pet
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
              onEdit={openEditMobile}
              onRequestDelete={setPetToDelete}
              deletePending={deleteMutation.isPending}
            />
          ))}

          {/* Add button — only when at least one pet exists. The empty
              state already renders its own "Add a pet" CTA, so showing this
              standalone one too would surface two identical CTAs at once. */}
          {!!pets?.length && (
            <Button
              variant="primary"
              className="w-full"
              size="lg"
              onClick={openAddMobile}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add a Pet
            </Button>
          )}

        </div>

        {/* ─── Desktop (lg+): split-column ─────────────────────────────── */}
        {/* SINGLE COLUMN on desktop (owner). Was a 12-col split (pets rail |
            detail pane); they now stack. Still `hidden lg:*` so the separate
            mobile stacked list above is untouched. */}
        <div className="hidden lg:block space-y-4">
          {/* Left rail — pets list */}
          <aside className="lg:col-span-4 xl:col-span-4 space-y-3">
            {/* No rail header. "Your pets" restated the page's own "My Pets"
                h1 directly beneath it, and its "+ Add" is now the title-row
                action (see PageHeader above) — so the card opens straight into
                the list it holds. */}
            <div className="rounded-ds-lg liquid-glass overflow-hidden">
              {isLoading && (
                <div className="p-3 space-y-2">
                  {[1, 2, 3].map((n) => (
                    <Skeleton key={n} className="rounded-ds-md h-14" />
                  ))}
                </div>
              )}

              {isError && (
                <div className="p-3">
                  <ErrorState
                    variant="inline"
                    title="We couldn't load your pets."
                    body="Tap Try again to reload."
                    onRetry={() => refetch()}
                  />
                </div>
              )}

              {!isLoading && !isError && pets?.length === 0 && (
                <div className="p-4">
                  <EmptyState
                    variant="inline"
                    icon={PawPrint}
                    title="No pets yet"
                    body="Add your first pet to get started."
                    action={
                      <Button variant="primary" size="sm" onClick={openAddDesktop}>
                        <Plus className="w-4 h-4 mr-1" /> Add a Pet
                      </Button>
                    }
                  />
                </div>
              )}

              {!!pets?.length && (
                <ul
                  className="max-h-[calc(100dvh-16rem)] overflow-y-auto divide-y"
                  style={{ borderColor: "hsl(var(--olivewood) / 0.08)" }}
                >
                  {pets.map((pet) => (
                    <li key={pet.id}>
                      <PetRailRow
                        pet={pet}
                        active={activePetId === pet.id && !desktopAdding}
                        onSelect={() => selectPetDesktop(pet)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

          </aside>

          {/* Right pane — active pet detail, inline create form, or empty */}
          <section className="lg:col-span-8 xl:col-span-8 min-w-0">
            <div
              className="max-h-[calc(100dvh-10rem)] overflow-y-auto pr-1"
              style={{ scrollbarGutter: "stable" }}
            >
              {desktopAdding && userId && (
                <PetForm
                  existingNames={(pets ?? []).map((p) => p.name)}
                  key="desktop-add"
                  variant="inline"
                  initialValues={null}
                  ownerId={userId}
                  onClose={() => setDesktopAdding(false)}
                  onSaved={handleSaved}
                />
              )}

              {!desktopAdding && activePet && (
                <PetDetail
                  key={activePet.id}
                  pet={activePet}
                  ownerId={userId ?? ""}
                  onSaved={handleSaved}
                  onRequestDelete={setPetToDelete}
                  deletePending={deleteMutation.isPending}
                />
              )}

              {/* Nothing renders here when there are NO pets. This pane's copy
                  ("Care details appear here once you add a pet.") described a
                  left/right split that no longer exists — the desktop layout is
                  `hidden lg:block`, a single stacked column, so the pane sits
                  UNDER the list rather than beside it. With zero pets that
                  stacked a third empty block below the list card's own "No pets
                  yet" empty state, both saying the same thing.

                  With pets, the prompt still earns its place: something IS
                  selectable above, and this says so. */}
              {!desktopAdding && !activePet && !isLoading && !!pets?.length && (
                <div
                  className="rounded-ds-lg liquid-glass flex flex-col items-center justify-center text-center px-8 py-16"
                >
                  <PawPrint
                    className="w-10 h-10 mb-3"
                    style={{ color: "hsl(var(--bark) / 0.4)" }}
                  />
                  <p
                    className="font-display text-ds-20 leading-tight"
                    style={{ color: "hsl(var(--ink-deep))" }}
                  >
                    Pick a pet from the list
                  </p>
                  <p className="text-ds-12 text-muted-foreground mt-1.5 max-w-sm">
                    Select a pet above to view their care details, or add a new one.
                  </p>
                </div>
              )}

              {isLoading && !activePet && (
                <Skeleton className="rounded-ds-lg h-96" />
              )}
            </div>
          </section>
        </div>

      {/* Mobile-only full-screen pet form sheet. Desktop uses the inline
          right-pane variant, so we only mount this when NOT in desktop-add
          mode and only when the mobile sheet was explicitly opened. */}
      {formOpen && userId && (
        <PetForm
          existingNames={(pets ?? []).map((p) => p.name)}
          initialValues={editingPet}
          ownerId={userId}
          onClose={() => setFormOpen(false)}
          onSaved={handleSaved}
        />
      )}

      <BrandConfirmDialog
        open={petToDelete !== null}
        onOpenChange={(open) => { if (!open) setPetToDelete(null); }}
        title={petToDelete ? `Remove ${petToDelete.name}?` : "Remove Pet?"}
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
    </AppPage>
  );
};

export default PetProfiles;
