/**
 * Audit 11-10 F326 (High): with no item in the photo the listing writer put its advice into the title ("Item photo
 * unclear - please retake photos"). A title that reads as a note about the photos is never filled in (SellAiDraft
 * noItemDraft) and never posts (sellForm formProblem). Pure, so sellForm.ts stays free of React.
 */
export const WRITER_WARNING_RE = /\b(unclear|retake|re-take|no item|not visible|isn't visible|can'?t (?:see|tell|make out)|cannot (?:see|tell|make out)|unable to (?:see|tell|identify)|please (?:add|upload|take|provide)|photo shows only|uniform gr[ae]y|too (?:dark|blurry))\b/i;

/** Said by the photos when the writer saw no item (nothing is filled in). */
export const NO_ITEM_SEEN = "We couldn't see an item in this photo. Try another photo in good light.";
