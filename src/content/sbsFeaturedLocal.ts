/**
 * Words for the Small Business Saturday "Featured local" section and its free sign-up form (owner 2026-11-20).
 * The 25 Days sponsors stay first with their badge (owner: "our small business sponsers still get lsited a the to of
 * the list with a badge"); approved free listings show below them. Guard: src/test/sbsFeaturedLocal1120.test.tsx.
 */
import type { SbsFieldError } from "../../supabase/functions/_shared/sbsSubmission";

export const SBS_WORDS = {
  // /shop-small (owner 2026-11-21: "add the feature that small business can sign their business up to be featured on
  // the site"): the live page for these listings and the form, now the Small Business Saturday guide page is retired.
  pageTitle: "Shop Small Louisiana",
  pageLead: "Louisiana small businesses, listed free. Small Business Saturday is Nov 28: buy a gift, book a visit, or give them a follow.",
  // Holiday audit 1121 #61: the confirmed Louisiana 25 Days sponsors lead /shop-small, so it is never an empty page.
  pageSponsorsTitle: "Our Louisiana 25 Days sponsors",
  pageSectionTitle: "Louisiana small businesses",
  pageSectionIntro: "Local shops and makers taking part in Small Business Saturday, Nov 28.",
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
  introLink: "Own a Louisiana small business? Get featured free",
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
      // Holiday audit 1121 area 5 #17: say what to do (tick the box), not only why.
      return "Tick this box to confirm you're taking part in Small Business Saturday.";
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
