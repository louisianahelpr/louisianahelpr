/**
 * Words for the Small Business Saturday "Featured local" section and its free sign-up form (owner 2026-11-20).
 * The 25 Days sponsors stay first with their badge (owner: "our small business sponsers still get lsited a the to of
 * the list with a badge"); approved free listings show below them. Guard: src/test/sbsFeaturedLocal1120.test.tsx.
 */
import type { SbsFieldError } from "../../supabase/functions/_shared/sbsSubmission";
import { dealDay } from "./giftGuideDeals.mjs";

/**
 * Small Business Saturday 2026: Sat Nov 28 (Thanksgiving is Thu Nov 26), from the deals days. Holiday audit 1121 #54:
 * the words that name the day, and the sign-up's required box, change the day after it (sbsDayWords), so the
 * page never asks a business to say it is "participating" in a day that has passed. Guard: src/test/sbsDayWords1124.test.tsx.
 */
export const SBS_DAY: string = dealDay("small-business-saturday")?.day ?? "2026-11-28";

export const SBS_WORDS = {
  // Holiday audit 1121 area 5 #4: the free listings say when they are loading, empty or did not load (they showed nothing).
  localLoading: "Loading Louisiana small businesses…",
  localEmptyBefore: "Local shops show here once we approve them. Check back before Small Business Saturday, Nov 28.",
  localEmptyAfter: "Local shops show here once we approve them.",
  localFailed: "The local shops didn't load. Check your connection and refresh the page.",
  landingLink: "Own a Louisiana small business? Get featured free",
  sectionTitle: "Featured local",
  sectionIntro: "More Louisiana small businesses taking part in Small Business Saturday, Nov 28.",
  badge: "Featured local",
  dealLabel: "Saturday deal:",
  ctaTitle: "Get your business featured",
  ctaLine: "Free for Louisiana small businesses taking part in Small Business Saturday, Nov 28. We'll review and add you within a day.",
  ctaButton: "Get featured, free",
  /** The one-line link at the top of the business list (owner 2026-11-21): jumps to the card and opens the form. */
  ctaTopLink: "Own a Louisiana small business? Get featured free",
  // Owner 2026-11-22 ("Let them filter z-a and a-z"): the sort beside that link; the first choice keeps the list's own order.
  // Consistency audit 1122 #6: the sliders icon has one name per action on every guides page ("Sort", as the guides).
  sortLabel: "Sort",
  sortLabelActive: (order: string) => `Sort, ${order}`,
  sortCategory: "By category",
  sortAz: "Name: A to Z",
  sortZa: "Name: Z to A",
  loadingForm: "Loading the form…",
  formFailed: "The form didn't load. Check your connection and try again.",
  formRetry: "Try again",
  fields: {
    businessName: "Business name",
    town: "Town",
    townHint: "Your Louisiana town",
    category: "Category",
    categoryPick: "Pick one",
    link: "Website, Facebook or Instagram link",
    linkHint: "Where shoppers can find you",
    // Holiday audit 1121 #76: an example, so it never reads as text already typed (it was "https://").
    linkPlaceholder: "e.g. https://yourshop.com",
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

/** The words that name Small Business Saturday on Louisiana day `today` (YYYY-MM-DD): unchanged through the day, then none. */
export function sbsDayWords(today: string) {
  const past = today > SBS_DAY;
  return {
    sectionIntro: past ? "More Louisiana small businesses, open all season." : SBS_WORDS.sectionIntro,
    ctaLine: past ? "Free for Louisiana small businesses. We'll review and add you within a day." : SBS_WORDS.ctaLine,
    dealLabel: past ? "Deal:" : SBS_WORDS.dealLabel,
    deal: past ? "Your holiday deal or note (optional)" : SBS_WORDS.fields.deal,
    dealHint: past ? "Like \"20% off all candles through Christmas\"" : SBS_WORDS.fields.dealHint,
    // The server still needs the box ticked (sbs_featured_submissions.participating CHECK); after the day it confirms
    // the business is a Louisiana small business instead.
    participating: past ? "We're a Louisiana small business." : SBS_WORDS.fields.participating,
    participatingError: past ? "Tick this box to confirm you're a Louisiana small business." : "Tick this box to confirm you're taking part in Small Business Saturday.",
  };
}

/** Words for a field's error code (`today`: the Louisiana day, for the participating box's words). */
export function sbsFieldError(field: string, code: SbsFieldError | "dead" | "logoType" | "logoSize" | string, today = ""): string {
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
      // Holiday audit 1121 area 5 #17: say what to do (tick the box), not only why.
      return sbsDayWords(today).participatingError;
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
