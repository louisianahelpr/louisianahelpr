import { useMemo } from "react";

export interface PostingQualityResult {
  score: number;          // 0–100
  label: "Needs work" | "Getting there" | "Good" | "Great";
  color: string;          // hsl value
  completedChecks: string[];
  missingChecks: string[];
}

interface PostingQualityInput {
  title: string;
  description: string;
  budget: number | null;
  category: string;
  photos: string[];
  city: string;
  scheduledDate: string | null;
  credentialTier: number;
  pricingMode: string;
}

export function usePostingQuality(input: PostingQualityInput): PostingQualityResult {
  return useMemo(() => {
    let score = 0;
    const completed: string[] = [];
    const missing: string[] = [];

    // Title (15 pts)
    if (input.title.trim().length >= 10) {
      score += 15; completed.push("Descriptive title");
    } else {
      missing.push("Add a descriptive title (10+ characters)");
    }

    // Description (30 pts — tiered)
    const descLen = input.description.trim().length;
    if (descLen >= 150) {
      score += 30; completed.push("Detailed description");
    } else if (descLen >= 80) {
      score += 18; completed.push("Description added");
      missing.push("Add more detail to your description");
    } else if (descLen >= 20) {
      score += 8;
      missing.push("Describe the job in more detail");
    } else {
      missing.push("Add a description of the job");
    }

    // Budget / pricing (20 pts)
    if (input.pricingMode === "accept_bids" || (input.budget && input.budget > 0)) {
      score += 20; completed.push("Budget set");
    } else {
      missing.push("Set a budget or choose Accept bids");
    }

    // Location (10 pts)
    if (input.city.trim().length > 0) {
      score += 10; completed.push("Location added");
    } else {
      missing.push("Add your city/neighborhood");
    }

    // Photos (15 pts)
    if (input.photos.length >= 2) {
      score += 15; completed.push("Photos attached");
    } else if (input.photos.length === 1) {
      score += 8; completed.push("1 photo added");
      missing.push("Add another photo");
    } else {
      missing.push("Add photos — posts with photos fill 40% faster");
    }

    // Date (10 pts)
    if (input.scheduledDate) {
      score += 10; completed.push("Date specified");
    } else {
      missing.push("Add a preferred date or timeframe");
    }

    const label: PostingQualityResult["label"] =
      score >= 85 ? "Great"
      : score >= 65 ? "Good"
      : score >= 40 ? "Getting there"
      : "Needs work";

    const color =
      score >= 85 ? "hsl(155 50% 35%)"
      : score >= 65 ? "hsl(var(--bark))"
      : score >= 40 ? "hsl(40 80% 45%)"
      : "hsl(var(--burnt-sienna))";

    return { score, label, color, completedChecks: completed, missingChecks: missing };
  }, [
    input.title,
    input.description,
    input.budget,
    input.category,
    input.photos.length,
    input.city,
    input.scheduledDate,
    input.pricingMode,
  ]);
}
