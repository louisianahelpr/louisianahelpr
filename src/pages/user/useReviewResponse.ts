import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import type { useUserProfileData } from "./useUserProfileData";

type ProfileData = ReturnType<typeof useUserProfileData>;

/**
 * Q806: UserProfile's review-response state and its save handler, moved verbatim out of UserProfile.tsx (pure move).
 */
export function useReviewResponse(
  setLocalReviews: ProfileData["setLocalReviews"],
  reviewsFromQuery: ProfileData["reviewsFromQuery"],
) {
  // Response-to-review state: which review is being responded to, and the draft text.
  const [respondingToReview, setRespondingToReview] = useState<string | null>(null);
  const [responseText, setResponseText] = useState("");
  const [savingResponse, setSavingResponse] = useState(false);

  // Save or update the reviewee's public response to a review they received.
  const handleSaveResponse = async (reviewId: string) => {
    // Tapping Save on an empty textarea used to do nothing at all — no toast,
    // no state change, no reason given. Say why instead of dead-ending.
    if (!responseText.trim()) {
      toast.error("Write a response first.");
      return;
    }
    setSavingResponse(true);
    try {
      const { error } = await supabase.rpc("respond_to_review", {
        _review_id: reviewId,
        _response_text: responseText.trim(),
      });
      if (error) {
        toast.error(isMissingRpcNamed(error, "respond_to_review") ? "Couldn't save your response right now — try again?" : "Couldn't save your response — try again?");
        return;
      }
      // Optimistic update locally so the response appears immediately.
      setLocalReviews((prev) =>
        (prev ?? reviewsFromQuery).map((r) =>
          r.id === reviewId
            ? { ...r, response_text: responseText.trim(), response_at: new Date().toISOString() }
            : r,
        ),
      );
      setRespondingToReview(null);
      setResponseText("");
    } catch {
      toast.error("Couldn't save your response — try again?");
    } finally {
      setSavingResponse(false);
    }
  };

  return { respondingToReview, setRespondingToReview, responseText, setResponseText, savingResponse, handleSaveResponse };
}
