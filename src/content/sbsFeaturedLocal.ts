/**
 * Words for the Small Business Saturday "Featured local" section and its free sign-up form (owner 2026-11-20).
 * The 25 Days sponsors stay first with their badge (owner: "our small business sponsers still get lsited a the to of
 * the list with a badge"); approved free listings show below them. Guard: src/test/sbsFeaturedLocal1120.test.tsx.
 */
import type { SbsFieldError } from "../../supabase/functions/_shared/sbsSubmission";

export const SBS_WORDS = {
  sectionTitle: "Featured local",
  sectionIntro: "More Louisiana small businesses taking part in Small Business Saturday, Nov 28.",
  badge: "Featured local",
  visitShort: "Visit",
  dealLabel: "Saturday deal:",
  introLink: "Own a Louisiana small business? Get featured free",
  ctaTitle: "Get your business featured",
  ctaLine: "Free for Louisiana small businesses taking part in Small Business Saturday, Nov 28. We'll review and add you within a day.",
  ctaButton: "Get featured, free",
  loadingForm: "Loading the form…",
  formFailed: "The form didn't load. Check your connection and try again.",
  fields: {
    businessName: "Business name",
    town: "Town",
    townHint: "Your Louisiana town",
    category: "Category",
    categoryPick: "Pick one",
    link: "Website, Facebook or Instagram link",
    linkHint: "Where shoppers can find you",
    deal: "Your Small Business Saturday deal or note (optional)",
    dealHint: "Like \"20% off all candles Saturday only\"",
    logo: "Logo (optional)",
    logoHint: "PNG, JPG or WebP, under 2 MB",
    logoChoose: "Choose logo",
    logoChange: "Change logo",
    logoRemove: "Remove",
    email: "Contact email",
    emailHint: "Private: only our team sees it, never shown on the page.",
    participating: "We're participating in Small Business Saturday.",
  },
  submit: "Send for review",
  sending: "Sending…",
  cancel: "Close",
  done: "Thanks! We'll review your business and add it within a day.",
  doneAgain: "Add another business",
  duplicate: "That business is already in for review or listed. Thanks!",
  rateLimited: "That's a lot of sign-ups at once. Try again in a few minutes.",
  server: "That didn't send. Check your connection and try again.",
} as const;

/** Words for a field's error code. */
export function sbsFieldError(field: string, code: SbsFieldError | "dead" | "logoType" | "logoSize" | string): string {
  switch (code) {
    case "required":
      return field === "category" ? "Pick a category." : "Please fill this in.";
    case "tooLong":
      return "That's a little long. Please shorten it.";
    case "email":
      return "Please enter a working email address.";
    case "url":
      return "Please enter your website, Facebook or Instagram link (no short links).";
    case "dead":
      return "We couldn't open that link. Check it and try again.";
    case "category":
      return "Pick a category.";
    case "participating":
      return "This list is for businesses taking part in Small Business Saturday.";
    case "profanity":
      return "Please keep it family friendly.";
    case "spam":
      return "Please leave links out of this box. Your link goes in the link box.";
    case "lodging":
      return "Sorry, we can't list motels or inns on this page.";
    case "town":
      return "Pick a Louisiana town from the list.";
    case "logoType":
      return "Logo must be a PNG, JPG or WebP picture.";
    case "logoSize":
      return "Logo must be under 2 MB.";
    default:
      return "Please check this.";
  }
}
