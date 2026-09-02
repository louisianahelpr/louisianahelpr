import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  assertUploadablePortfolioImage,
  reconcilePortfolioObjects,
  uploadPortfolioImage,
} from "@/lib/portfolioStorage";
import type { Profile } from "./types";

export const MAX_PORTFOLIO = 6;

interface UsePortfolioArgs {
  profile: Profile | null;
  onPortfolioChange?: (urls: string[]) => void;
}

/**
 * Work portfolio (profiles.portfolio_urls) — helpers upload up to 6 photos of
 * previous work; applicants see these on the public profile when deciding
 * whether to apply. Uses the same `avatars` public bucket as the profile photo
 * (path-scoped to user).
 *
 * REMOVING A PHOTO USED TO REMOVE NOTHING. `removePortfolioAt` rewrote
 * `portfolio_urls` and never touched storage, so the object stayed anonymously
 * fetchable at 200 forever — verified against prod. Keys also embedded the
 * uploaded FILE NAME's suffix, the same defect the avatar path had. Both are
 * fixed in `@/lib/portfolioStorage`, which owns the key scheme and the
 * verified-by-re-list sweep; this hook only sequences the column write and the
 * reconcile. Read that file's header before changing anything here.
 */
export function usePortfolio({ profile, onPortfolioChange }: UsePortfolioArgs) {
  const portfolioUrls: string[] = profile?.portfolio_urls ?? [];
  const [portfolioUploading, setPortfolioUploading] = useState(false);
  const portfolioInputRef = useRef<HTMLInputElement>(null);

  /**
   * Write the column, then make storage match it.
   *
   * Order is load-bearing: the column is the record of what the user wants
   * public, so it is written FIRST and the sweep is driven off the value that
   * actually landed. Sweeping first would delete an object and then possibly
   * fail to save, leaving a profile pointing at a photo that no longer exists.
   *
   * The sweep runs on EVERY write, not just removals — that is what makes it
   * self-healing for the orphans the old code already left behind.
   */
  const persistPortfolio = async (next: string[]) => {
    const userId = profile?.user_id;
    if (!userId) return;
    const { error } = await supabase
      .from("profiles")
      .update({ portfolio_urls: next })
      .eq("user_id", userId);
    if (error) {
      toast.error("Couldn't save your work photos.");
      return;
    }
    onPortfolioChange?.(next);

    // Never throws, and never blocks the save — but a non-empty result means a
    // photo the user just removed is STILL publicly fetchable, which is exactly
    // the thing they were trying to undo, so they are told rather than left to
    // assume it worked. Already logged to `error_logs` inside the module.
    const { staleRemaining } = await reconcilePortfolioObjects(supabase, userId, next);
    if (staleRemaining.length > 0) {
      toast.error(
        "Your profile is updated, but we couldn't delete the removed photo from storage yet — it may still be viewable. Please try again.",
      );
    }
  };

  const handlePortfolioPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const userId = profile?.user_id;
    if (!userId) return;

    const slotsLeft = MAX_PORTFOLIO - portfolioUrls.length;
    if (slotsLeft <= 0) {
      toast.error(`Maximum ${MAX_PORTFOLIO} photos.`);
      return;
    }
    // Validated against the bucket's OWN limits rather than a looser guess:
    // `image/*` accepted HEIC and SVG, which the bucket then rejected with an
    // opaque `mime type ... is not supported` the user could do nothing with.
    const usable = files.slice(0, slotsLeft).filter((f) => {
      try {
        assertUploadablePortfolioImage(f);
        return true;
      } catch (err) {
        toast.error(
          `Skipping ${f.name} — ${err instanceof Error ? err.message : "unsupported file."}`,
        );
        return false;
      }
    });
    if (!usable.length) return;

    setPortfolioUploading(true);
    const uploaded: string[] = [];
    for (const file of usable) {
      try {
        // Key derived from the content type at a fresh random id — never from
        // `file.name`. See `@/lib/portfolioStorage`.
        const { publicUrl } = await uploadPortfolioImage(supabase, userId, file, file.type);
        uploaded.push(publicUrl);
      } catch {
        toast.error(`Couldn't upload ${file.name}`);
        continue;
      }
    }
    setPortfolioUploading(false);
    if (!uploaded.length) return;
    await persistPortfolio([...portfolioUrls, ...uploaded]);
  };

  /**
   * Drop one photo. `persistPortfolio` writes the column and then reconciles
   * storage against it, so the object is actually deleted — and the delete is
   * verified by re-listing, because `.remove()` reports `{ error: null }` when
   * RLS filtered the path out.
   */
  const removePortfolioAt = async (i: number) => {
    const next = portfolioUrls.filter((_, idx) => idx !== i);
    await persistPortfolio(next);
  };

  return {
    portfolioUrls,
    portfolioUploading,
    portfolioInputRef,
    handlePortfolioPick,
    removePortfolioAt,
  };
}
