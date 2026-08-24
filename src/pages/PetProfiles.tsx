import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
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
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      {/* No `showBrand`: /pets is a Profile sub-page, not a top-level
          destination. The Helpr wordmark (which links to /dashboard) made it
          read as standalone and competed with the back-to-Profile chevron.
          The back button + title now carry the navigation context. */}
      <PageHeader
        title="My Pets"
        backTo="/profile"
        // No `width` — the header takes its `default` geometry, which IS the
        // body class below, so title and content share one edge at every size.
      />

            {/* CANONICAL DOCUMENT-SCROLL SHELL — identical on every page that wears
          it: `min-h-screen bg-premium-page pb-safe-nav` > <PageHeader> (default
          width) > `page-measure mx-auto px-5 lg:px-8 xl:px-12 pt-4 pb-8`.
          The header's `default` width IS this body class, so the title and the
          content share one left edge at every breakpoint. Owner: these pages
          "should share layouts ... there should not be any off from the rest",
          so do not give this page its own max-width or gutter ladder. */}
      <div className="page-measure mx-auto px-5 lg:px-8 xl:px-12 pt-4 pb-8">
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
        <div className="hidden lg:grid lg:grid-cols-12 lg:gap-8 lg:items-start">
          {/* Left rail — pets list */}
          <aside className="lg:col-span-4 xl:col-span-4 space-y-3">
            <div className="rounded-ds-lg liquid-glass overflow-hidden">
              {/* Rail header + add */}
              <div
                className="flex items-center justify-between px-4 py-3 border-b"
                style={{ borderColor: "hsl(var(--olivewood) / 0.10)" }}
              >
                <p
                  className="font-sans font-semibold text-ds-14"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  Your pets
                </p>
                <button
                  type="button"
                  onClick={openAddDesktop}
                  className="inline-flex items-center gap-1 text-ds-12 font-semibold px-2 py-1 rounded-ds-sm transition-colors active:bg-secondary/40"
                  style={{ color: "hsl(var(--bark))" }}
                  aria-label="Add a Pet"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>

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

              {!desktopAdding && !activePet && !isLoading && (
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
                    {pets?.length ? "Pick a pet from the list" : "Add your first pet"}
                  </p>
                  <p className="text-ds-12 text-muted-foreground mt-1.5 max-w-sm">
                    {pets?.length
                      ? "Select a pet on the left to view their care details, or add a new one."
                      : "Care details help your Helpr know what your pet needs."}
                  </p>
                  {!pets?.length && (
                    <Button
                      variant="primary"
                      className="mt-4"
                      onClick={openAddDesktop}
                    >
                      <Plus className="w-4 h-4 mr-1" /> Add a Pet
                    </Button>
                  )}
                </div>
              )}

              {isLoading && !activePet && (
                <Skeleton className="rounded-ds-lg h-96" />
              )}
            </div>
          </section>
        </div>
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
    </div>
  );
};

export default PetProfiles;
