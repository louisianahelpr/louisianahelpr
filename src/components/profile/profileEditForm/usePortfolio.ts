import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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
 */
export function usePortfolio({ profile, onPortfolioChange }: UsePortfolioArgs) {
  const portfolioUrls: string[] = profile?.portfolio_urls ?? [];
  const [portfolioUploading, setPortfolioUploading] = useState(false);
  const portfolioInputRef = useRef<HTMLInputElement>(null);

  const persistPortfolio = async (next: string[]) => {
    const userId = profile?.user_id;
    if (!userId) return;
    const { error } = await supabase
      .from("profiles")
      .update({ portfolio_urls: next })
      .eq("user_id", userId);
    if (error) {
      toast.error("Couldn't save your work photos");
      return;
    }
    onPortfolioChange?.(next);
  };

  const handlePortfolioPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const userId = profile?.user_id;
    if (!userId) return;

    const slotsLeft = MAX_PORTFOLIO - portfolioUrls.length;
    if (slotsLeft <= 0) {
      toast.error(`Maximum ${MAX_PORTFOLIO} photos`);
      return;
    }
    const usable = files.slice(0, slotsLeft).filter((f) => {
      if (!f.type.startsWith("image/")) {
        toast.error(`Skipping ${f.name} (not an image)`);
        return false;
      }
      if (f.size > 5 * 1024 * 1024) {
        toast.error(`Skipping ${f.name} (over 5 MB)`);
        return false;
      }
      return true;
    });
    if (!usable.length) return;

    setPortfolioUploading(true);
    const uploaded: string[] = [];
    for (const file of usable) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${userId}/portfolio/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) {
        toast.error(`Couldn't upload ${file.name}`);
        continue;
      }
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      uploaded.push(urlData.publicUrl);
    }
    setPortfolioUploading(false);
    if (!uploaded.length) return;
    await persistPortfolio([...portfolioUrls, ...uploaded]);
    toast.success(`Added ${uploaded.length} ${uploaded.length === 1 ? "photo" : "photos"} to your work`);
  };

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
