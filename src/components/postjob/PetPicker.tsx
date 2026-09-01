import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PawPrint, Plus, Check } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { report } from "@/lib/errorLogger";
import { hapticLight } from "@/lib/haptics";

/**
 * "Which pet is this for?" — the START of the pet-care flow, which did not
 * exist.
 *
 * A poster could build a full pet profile (feeding schedule, medications, vet,
 * emergency contact, behaviour) and then had no way to hand any of it to the
 * sitter: nothing on Post a Job referenced `pet_profiles`, so the information
 * either got retyped into the free-text requirements box or never reached the
 * person holding the leash (owner: "whats the point of adding a pet if it
 * doesnt allow them to attach that info for a pet posting").
 *
 * Attaching a pet writes `job_pets`, and the assigned helper reads the care
 * sheet through `get_job_pets` — see migration 20260823160000.
 *
 * SHOWN ONLY ON A PET-CARE JOB. It is a category-specific question, and asking
 * "which pet?" on a furniture-assembly post is noise.
 *
 * A poster with NO pets still sees it, unlike the saved-helpr picker which
 * self-hides — because here the empty state is the useful part: this is the
 * moment somebody realises they can put their dog's details in once instead of
 * writing them out every time.
 */
type PetLite = {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  photo_url: string | null;
};

export function PetPicker({
  selectedIds,
  onToggle,
}: {
  selectedIds: string[];
  onToggle: (petId: string) => void;
}) {
  const { user } = useCurrentUser();

  const { data: pets, isError, error } = useQuery({
    queryKey: ["pet_profiles_for_post", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error: qErr } = await supabase
        .from("pet_profiles")
        .select("id, name, species, breed, photo_url")
        .order("name");
      if (qErr) throw qErr;
      return (data ?? []) as PetLite[];
    },
  });

  if (isError) report(error, { tags: { source: "PetPicker.pet_profiles" } });

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-ds-11 font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
          Which pet is this for?
        </p>
        <Link
          to="/pets"
          className="text-ds-11 font-medium inline-flex items-center gap-1 btn-press"
          style={{ color: "hsl(var(--bark))" }}
        >
          <Plus className="w-3 h-3" /> Add a pet
        </Link>
      </div>

      {!pets ? (
        <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Loading your pets…
        </p>
      ) : pets.length === 0 ? (
        <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          You haven&rsquo;t added a pet yet. Adding one lets you send their feeding
          schedule, vet and any medications straight to the Helpr — once, instead
          of typing it out on every post.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {pets.map((p) => {
              const on = selectedIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => { hapticLight(); onToggle(p.id); }}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-ds-md squircle border text-left btn-press transition-all duration-200 min-h-11"
                  style={
                    on
                      ? {
                          background: "hsl(var(--bark) / 0.10)",
                          borderColor: "hsl(var(--bark) / 0.45)",
                        }
                      : {
                          background: "hsl(var(--background) / 0.7)",
                          borderColor: "hsl(var(--border) / 0.6)",
                        }
                  }
                >
                  {p.photo_url ? (
                    <img
                      src={p.photo_url}
                      alt=""
                      aria-hidden
                      className="w-8 h-8 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <span
                      className="w-8 h-8 rounded-full shrink-0 inline-flex items-center justify-center"
                      style={{ background: "hsl(var(--petcare-ink) / 0.12)" }}
                      aria-hidden
                    >
                      <PawPrint className="w-4 h-4" style={{ color: "hsl(var(--petcare-ink))" }} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-ds-13 font-semibold text-foreground truncate">
                      {p.name}
                    </span>
                    <span
                      className="block font-serif italic text-ds-11 truncate"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      {[p.breed, p.species].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {on && (
                    <Check
                      className="w-4 h-4 shrink-0"
                      style={{ color: "hsl(var(--bark))" }}
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </div>
          <p className="font-serif italic text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            The Helpr you pick sees their feeding schedule, medications, vet and
            emergency contact once the job is theirs — nobody else does.
          </p>
        </>
      )}
    </div>
  );
}
