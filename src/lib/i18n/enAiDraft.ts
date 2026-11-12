/**
 * The sell form's "we write your listing from your photos" panel in English (F260q): SellAiDraft.tsx. One panel's words,
 * imported by that panel only, so they are inlined into its chunk (Q178); it rides with the Sell screens and the job
 * page's list-for-the-seller step, which load different dictionaries. Spanish: esAiDraft.ts. The listing the photo tool
 * writes (title, details, price reason, photo tip) is the tool's own words, English for now.
 */
import { addEnglish } from "./enRegistry";

export const enAiDraft = {
  "aid.busy": "We're writing your listing…",
  "aid.busyBody": "It looks at your photos for the name, details, category, size, condition and a fair price. This takes a few seconds.",
  "aid.busyBodyFree": "It looks at your photos for the name, details, category, size, condition. This takes a few seconds.",
  "aid.tryAgain": "Try again",
  "aid.noItem": "We couldn't see an item in this photo. Try another photo in good light.",
  "aid.done": "We wrote your listing. Check it before you post",
  "aid.photoTip": "One more photo would help:",
  "aid.price": "Suggested price: ${amount}",
  "aid.flagged": "This item may not be allowed, so someone from Louisiana Helpr will look at it before it goes up.",
  "aid.hintOne": "Check it below and change anything.",
  "aid.hintSteps": "Check it and change anything on the next steps.",
  "aid.again": "Write it again",
  "aid.idle": "We can write the name, details, category, size and condition from your photos.",
  "aid.write": "Write my listing",
} as const;

addEnglish(enAiDraft);
