import { useEffect, useRef, useState } from "react";
import { categoryFromTitle } from "@/lib/categoryFromTitle";

interface UseAutoCategoryArgs {
  title: string;
  category: string;
  setCategory: (v: string) => void;
}

/**
 * Smart category detection — when the poster pauses typing the title
 * for ~800ms we check a keyword→category map. The match becomes the
 * new category and a tiny pill appears so the user can revert in one
 * tap if the guess is wrong. We never overwrite a category the user
 * picked manually after the auto-pick, so once they tap a chip the
 * smart pick is locked out for the rest of the session.
 */
export function useAutoCategory({
  title,
  category,
  setCategory,
}: UseAutoCategoryArgs) {
  const autoCategoryArmedRef = useRef(true);
  const lastAutoPickedRef = useRef<string | null>(null);
  const [autoCategoryHint, setAutoCategoryHint] = useState<string | null>(null);

  useEffect(() => {
    if (!autoCategoryArmedRef.current) return;
    const trimmed = title.trim();
    if (trimmed.length < 4) {
      if (autoCategoryHint) setAutoCategoryHint(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const guess = categoryFromTitle(trimmed);
      if (!guess) return;
      // Don't fight the user: skip when they've already chosen something
      // other than the default and that pick wasn't the previous auto-pick.
      if (
        category !== "other" &&
        category !== guess &&
        category !== lastAutoPickedRef.current
      ) {
        return;
      }
      if (guess === category) return;
      lastAutoPickedRef.current = guess;
      setCategory(guess);
      setAutoCategoryHint(guess);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [title, category, setCategory, autoCategoryHint]);

  return { autoCategoryArmedRef, autoCategoryHint, setAutoCategoryHint };
}
