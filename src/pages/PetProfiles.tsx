import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { Button } from "@/components/ui/button";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { unwrap } from "@/lib/supabaseResult";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { report } from "@/lib/errorLogger";
import { Plus, PawPrint } from "lucide-react";
import type { PetProfile } from "./petProfiles/types";
import { PetForm } from "./petProfiles/PetForm";
import { PetCard } from "./petProfiles/PetCard";
import { PetRailRow } from "./petProfiles/PetRailRow";
import { PetDetail } from "./petProfiles/PetDetail";

// ─── Main page ────────────────────────────────────────────────────────────────

/**
 * PetsTab — the Profile "Pets" tab.
 *
 * Was the standalone route `/pets` until 2026-09-02. It was only ever reached
 * FROM Profile (the landing rows, the nav quick-menu and the desktop nav all
 * pointed at it), so it was a Profile tab wearing a route's clothes — which is
 * the whole reason it looked like a different screen from its siblings. Owner:
 * "anything in profile tab should not be a stand alone tab."
 *
 * Renders the canonical tab body — `space-y-4` under a ProfileTabHeader — and
 * NOT AppPage. AppPage is AppShell + that header, and Profile.tsx already owns
 * the AppShell; keeping it here would nest two 100dvh viewport locks.
 */
const PetProfiles = ({ onBack }: { onBack?: () => void }) => {
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
      hapticSuccess();
      toast("Pet removed");
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

  // Mobile add: open the shared popup form.
  const openAddMobile = () => {
    setEditingPet(null);
    setFormOpen(true);
  };

  // Desktop only: the inline create form is appended BELOW the pets list in
  // the single stacked column, so on a tall list — or on the empty state,
  // whose card is nearly a full viewport on its own — tapping "Add a Pet"
  // rendered the form entirely off screen and read as a dead button.
  // Measured at 1440x900 with no pets: the form's header landed at y=1140,
  // 240px past the fold. The mobile path has never had this problem (its form
  // is a popup over the page), which is why it went unnoticed.
  const inlineFormRef = useRef<HTMLDivElement>(null);

  // Desktop add: reveal the inline right-pane create form, clearing the
  // active-pet URL param so the pane isn't showing a detail underneath.
  const openAddDesktop = () => {
    setDesktopAdding(true);
    const next = new URLSearchParams(searchParams);
    next.delete("pet");
    setSearchParams(next, { replace: true });
    // After the state lands, not before — the node does not exist on the tap.
    requestAnimationFrame(() => {
      inlineFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
    // The canonical Profile tab body: `space-y-4` under a ProfileTabHeader,
    // matching every other tab. NOT AppPage — that is AppShell + this header,
    // and Profile.tsx already owns the AppShell.
    //
    // Title-row "Add" restored
    // (2026-08-30 fix): the empty-state CTA only exists before the first pet
    // is added — once pets are in the list, desktop had NO way to add
    // another (the aside deliberately dropped its own header, and neither
    // the rail rows nor the detail pane carry an add action). `hidden lg:*`
    // because mobile already has its own "Add a Pet" affordances below the
    // list and inside the empty state.
    <div className="space-y-4">
      <ProfileTabHeader
        title="My Pets"
        onBack={onBack}
        rightSlot={
          <Button
            variant="primary"
            size="sm"
            className="hidden lg:inline-flex"
            onClick={openAddDesktop}
          >
            <Plus className="w-4 h-4 mr-1" /> Add a Pet
          </Button>
        }
      />
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
                        onEdit={openEditMobile}
                        onRequestDelete={setPetToDelete}
                        deletePending={deleteMutation.isPending}
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
                <div ref={inlineFormRef}>
                  <PetForm
                    existingNames={(pets ?? []).map((p) => p.name)}
                    key="desktop-add"
                    variant="inline"
                    initialValues={null}
                    ownerId={userId}
                    onClose={() => setDesktopAdding(false)}
                    onSaved={handleSaved}
                  />
                </div>
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

              {/* No "Pick a pet from the list" prompt (owner, 2026-08-30:
                  "remove"). The desktop layout is a single stacked column, so
                  this sat directly UNDER the list it was pointing at — a
                  full-height card whose only content was an instruction to use
                  the thing immediately above it. Selecting a pet fills this
                  space with the real detail pane; until then it stays empty. */}

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
        secondaryLabel="Cancel"
      />
    </div>
  );
};

export default PetProfiles;
